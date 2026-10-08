import { defineStore } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { z } from 'zod'
import { accountJournalCodec, moneyAccountsCodec } from '@molvia/model'
import type { AccountCheckBody, AccountJournalResponse, MoneyAccountsResponse } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { spendingOf, useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { read, write } from '@/stores/storage'
import { reportFailure } from '@/failures'

/**
 * The accounts as this phone last heard them, per owner (MOL-123, Р-1): the page whole — its
 * `countedAt` is the «на 14:05» of the offline strip — and the first page of the journal of the
 * last three accounts opened. Read back through the strict codecs: a change of the contract
 * empties it rather than drawing what this version cannot read.
 */
const KEY = 'molvia.accounts'
const KEPT_JOURNALS = 3

const keptSchema = z.object({
  overview: z.unknown().optional(),
  journals: z.record(z.string(), z.object({ answer: z.unknown(), at: z.string() })).optional(),
})
type Kept = z.infer<typeof keptSchema>

function recallAll(owner: string): Kept {
  const raw = read(`${KEY}.${owner}`)
  if (!raw) return {}
  try {
    const parsed = keptSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function recallOverview(owner: string): MoneyAccountsResponse | null {
  const answer = moneyAccountsCodec.safeParse(recallAll(owner).overview)
  return answer.success ? answer.data : null
}

/** The first page of an account's journal as last read — what the account's screen opens on offline. */
export function recallJournal(owner: string, id: string): AccountJournalResponse | null {
  const kept = recallAll(owner).journals?.[id]
  const answer = accountJournalCodec.safeParse(kept?.answer)
  return answer.success ? answer.data : null
}

export function rememberJournal(owner: string, answer: AccountJournalResponse): void {
  const all = recallAll(owner)
  const journals = {
    ...all.journals,
    [answer.account.id]: {
      answer: accountJournalCodec.encode(answer),
      at: new Date().toISOString(),
    },
  }
  const newest = Object.entries(journals)
    .sort(([, a], [, b]) => b.at.localeCompare(a.at))
    .slice(0, KEPT_JOURNALS)
  write(`${KEY}.${owner}`, JSON.stringify({ ...all, journals: Object.fromEntries(newest) }))
}

function rememberOverview(owner: string, answer: MoneyAccountsResponse): void {
  const all = recallAll(owner)
  write(`${KEY}.${owner}`, JSON.stringify({ ...all, overview: moneyAccountsCodec.encode(answer) }))
}

/** `idle` — no identity; `ready` — something to draw, fresh or remembered. */
export type AccountsPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

/**
 * «Счета» for every screen that shows or picks one (MOL-123): the row «Счета» of «Деньги», the page,
 * the pickers of four sheets and the cards of exchanges and incomes. The balances are the server's; the
 * phone adds nothing up. Read again whenever a queue has had an answer — a spending or a trip that
 * landed has moved a balance — and whenever a write of an account answers with the page whole.
 */
export const useAccountsStore = defineStore('accounts', () => {
  const actor = useActorStore()
  const spendings = useSpendingQueueStore()
  const trips = useTripQueueStore()

  const shown = ref<MoneyAccountsResponse | null>(null)
  /**
   * The account just deleted, offered back on «Счета» for the ten seconds of its strip — wherever it
   * was deleted from: its own screen leads back to the page (handoff 03). The server keeps it ten
   * minutes; the strip is what the screen offers.
   */
  const removed = ref<{
    readonly id: string
    readonly name: string
    readonly stamp: number
  } | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  /**
   * Screens showing accounts that are up now. A queue's answer reads the page again only for them:
   * read for every purchase at the shelf, the dearest answer of the server went out beside the queue
   * itself with nobody looking (adversarial round 2, Н2). Each of them reads it as it comes up.
   */
  const viewers = ref(0)
  /** The answer on screen came in this session, not from the phone's memory. */
  const confirmed = ref(false)
  /**
   * How many transfers this phone wrote, amended, removed or brought back (MOL-253): a transfer is
   * written with a connection, never through a queue, so the journals and the month read again by
   * this rather than by a queue's landing.
   */
  const transfers = ref(0)

  function adopt(): void {
    const id = actor.id
    shown.value = id ? recallOverview(id) : null
    removed.value = null
    failure.value = null
    confirmed.value = false
  }

  let latest = 0
  let running: Promise<void> | null = null
  let asks = 0

  async function ask(owner: string): Promise<void> {
    const mine = ++latest
    try {
      const answer = await api.moneyAccounts()
      if (actor.id !== owner || mine !== latest) return
      accept(answer)
    } catch (error) {
      reportFailure(error, 'screen')
      if (actor.id !== owner || mine !== latest) return
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  /** Asks the server; a call made while one is on its way asks once more after it. */
  async function refresh(): Promise<void> {
    if (!actor.id) return
    asks += 1
    if (running) return running
    running = (async () => {
      let served = 0
      while (served !== asks) {
        served = asks
        const owner = actor.id
        if (!owner) break
        await ask(owner)
      }
    })().finally(() => {
      running = null
    })
    return running
  }

  /** The page as a write answered it: newer than anything asked for before it. */
  function accept(answer: MoneyAccountsResponse): void {
    const owner = actor.id
    if (!owner) return
    latest += 1
    shown.value = answer
    failure.value = null
    confirmed.value = true
    rememberOverview(owner, answer)
  }

  /**
   * A check to send again once the «Прочее · сверка» written for it has reached the server (В-5
   * MOL-115), by the spending's name: kept here and not in the sheet, which may be closed, or the
   * screen left, before the queue is through — and one unrelated spending stuck in the queue must
   * not hold it back. Lost with the page on a reload: the next check counts from the last even one.
   */
  const repeats = new Map<string, { accountId: string; check: AccountCheckBody }>()

  async function repeat(accountId: string, check: AccountCheckBody): Promise<void> {
    try {
      await api.checkAccount(accountId, check)
    } catch {
      // Not repeated: the next check of the account counts again from its last even one.
    }
    void refresh()
  }

  function settleRepeats(): void {
    for (const [spendingId, waiting] of repeats) {
      if (spendings.pending.some((write) => spendingOf(write) === spendingId)) continue
      repeats.delete(spendingId)
      void repeat(waiting.accountId, waiting.check)
    }
  }

  function repeatAfter(spendingId: string, accountId: string, check: AccountCheckBody): void {
    repeats.set(spendingId, { accountId, check })
  }

  adopt()
  watch(
    () => actor.id,
    () => {
      latest += 1
      adopt()
    },
  )
  watch(
    () => [spendings.landed, trips.wrote],
    () => {
      settleRepeats()
      if (viewers.value > 0 && (shown.value || failure.value)) void refresh()
    },
  )

  const phase = computed<AccountsPhase>(() => {
    if (!actor.id) return 'idle'
    if (shown.value) return 'ready'
    return failure.value ?? 'loading'
  })

  return {
    phase,
    overview: computed(() => shown.value),
    accounts: computed(() => shown.value?.accounts ?? []),
    /** Why the page on screen is not an answer of this session, or null when it is. */
    stale: computed<'loading' | 'offline' | 'error' | null>(() => {
      if (!shown.value || confirmed.value) return null
      return failure.value ?? 'loading'
    }),
    removed,
    viewers,
    transfers,
    refresh,
    accept,
    repeat,
    repeatAfter,
  }
})

/**
 * The calling screen shows accounts («Деньги» with its row «Счета», «Счета», an account, «Обмен денег»):
 * while it is up, a queue's answer reads the page again (adversarial round 2, Н2).
 */
export function useAccountsOnScreen(): void {
  const store = useAccountsStore()
  onMounted(() => (store.viewers += 1))
  onUnmounted(() => (store.viewers -= 1))
}
