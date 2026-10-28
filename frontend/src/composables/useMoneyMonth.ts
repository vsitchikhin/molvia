import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { monthOf, moneyMonthCodec } from '@molvia/model'
import type { MoneyMonthView } from '@molvia/model'
import { api } from '@/api'
import { mergePages } from '@/components/spending'
import { useReconnect } from '@/composables/useReconnect'
import { localDay } from '@/days'
import { isRecord } from '@/stores/queueing'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { read, write } from '@/stores/storage'
import { reportFailure } from '@/failures'

/** `idle` — no identity, so there is no month to read. */
export type MoneyPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

/** Why the month on screen is not an answer of this session. */
export type MoneyStale = 'loading' | 'offline' | 'error'

export interface MoneyMonth {
  readonly phase: ComputedRef<MoneyPhase>
  readonly month: ComputedRef<MoneyMonthView | null>
  readonly stale: ComputedRef<MoneyStale | null>
  readonly fetchedAt: ComputedRef<Date | null>
  /** How many reads failed: a strip of «сервер не ответил» says its words again on a new one (C1). */
  readonly attempt: ComputedRef<number>
  /** When the read of the month on screen set out (MOL-151, adversarial Б1). */
  readonly askedAt: ComputedRef<Date | null>
  /** The owner's categories: this month's answer's, or those of the newest month kept. */
  readonly knownCategories: ComputedRef<MoneyMonthView['categories']>
  /**
   * When the month that names them was asked for — never its fetch: an amendment of a category that
   * landed before is in it (MOL-285). None for the categories recalled from another month kept.
   */
  readonly categoriesAskedAt: ComputedRef<Date | null>
  /** The ids the chips of a spending stand first by (MOL-198), of the same answer as the categories. */
  readonly knownFrequent: ComputedRef<MoneyMonthView['frequent']>
  /**
   * «Мой курс на сегодня» — the running month's rate, from its answer kept on the phone when another
   * month is on screen (review С-5): a spending is written today whatever month is looked at.
   */
  readonly todayRate: ComputedRef<MoneyMonthView['rate']>
  /** The next page is being read, or could not be. */
  readonly more: ComputedRef<'idle' | 'loading' | 'failed'>
  readonly loadMore: () => Promise<void>
  readonly retry: () => Promise<void>
}

/**
 * The last months read, per owner — the first page of each, the one the screen opens on. Three:
 * this month, the one before, and one more looked at; offline is a strip over them, not an empty
 * screen (handoff 04). This month stays among them however far back the person looked: it holds
 * today's rate for a sheet opened on any month (MOL-262, adversarial А3). Read back through the
 * strict codec — a change of the contract empties it, but for a field added with a default, which
 * reads as the default: a month kept before the ring (MOL-156) has none until it is read again,
 * and «Куда ушли» says so — the phone adds nothing up.
 */
const KEY = 'molvia.money'
const KEPT_MONTHS = 3

interface Remembered {
  readonly answer: MoneyMonthView
  readonly fetchedAt: Date
  /**
   * When the read set out: what the server knew is as of then, not of when the answer came. Kept on
   * the phone with the answer, or a read that set out before a removal and came after it would
   * show the removed row again after a restart (MOL-151, Б6); a month kept before it was has only
   * its arrival, older than any removal remembered since.
   */
  readonly askedAt?: Date
}

function recallAll(owner: string): Record<string, unknown> {
  const raw = read(`${KEY}.${owner}`)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function recall(owner: string, month: string): Remembered | null {
  const kept = recallAll(owner)[month]
  if (!isRecord(kept)) return null
  const answer = moneyMonthCodec.safeParse(kept.answer)
  const fetchedAt = typeof kept.fetchedAt === 'string' ? new Date(kept.fetchedAt) : null
  if (!answer.success || !fetchedAt || Number.isNaN(fetchedAt.getTime())) return null
  const askedAt = typeof kept.askedAt === 'string' ? new Date(kept.askedAt) : null
  return askedAt && !Number.isNaN(askedAt.getTime())
    ? { answer: answer.data, fetchedAt, askedAt }
    : { answer: answer.data, fetchedAt }
}

function newestKept(owner: string): Remembered | undefined {
  return Object.keys(recallAll(owner))
    .map((month) => recall(owner, month))
    .filter((one): one is Remembered => one !== null)
    .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0]
}

/** The categories of the newest month kept for the owner — any month names all of them. */
export function recallCategories(owner: string): MoneyMonthView['categories'] {
  return newestKept(owner)?.answer.categories ?? []
}

/** The chips' frequent ones of the newest month kept for the owner (MOL-198), as its categories. */
export function recallFrequent(owner: string): MoneyMonthView['frequent'] {
  return newestKept(owner)?.answer.frequent ?? []
}

/** The rate of the running month as last answered — only a month read while it was running. */
function recallTodayRate(owner: string): MoneyMonthView['rate'] {
  const today = monthOf(localDay())
  const running = recall(owner, today)
  return running?.answer.rateKind === 'live' ? running.answer.rate : null
}

/**
 * Keeps a first page unless one that set out later is kept already, and says whether it did: two
 * reads of a month may land out of turn — the running month's read for today's rate goes beside the
 * screen's own, and a screen left still hears its answer (MOL-262, adversarial А6). A read kept from
 * a moment still to come is a clock set back since, and is no later one; nor is one the phone cannot
 * read back — another build's — which knows nothing a refusal could take (self-review 12).
 */
function remember(owner: string, answer: MoneyMonthView, fetchedAt: Date, askedAt: Date): boolean {
  const later = recall(owner, answer.month)?.askedAt?.getTime() ?? Number.NaN
  if (later > askedAt.getTime() && later <= Date.now()) return false
  const all = recallAll(owner)
  all[answer.month] = {
    answer: moneyMonthCodec.encode(answer),
    fetchedAt: fetchedAt.toISOString(),
    askedAt: askedAt.toISOString(),
  }
  const running = monthOf(localDay())
  const newest = Object.entries(all)
    .flatMap(([month, value]) =>
      isRecord(value) && typeof value.fetchedAt === 'string'
        ? [{ month, value, at: value.fetchedAt }]
        : [],
    )
    .sort(
      (a, b) =>
        Number(b.month === running) - Number(a.month === running) || b.at.localeCompare(a.at),
    )
    .slice(0, KEPT_MONTHS)
    .map(({ month, value }) => [month, value])
  write(`${KEY}.${owner}`, JSON.stringify(Object.fromEntries(newest)))
  return true
}

/**
 * One month of «Деньги» as this phone sees it (MOL-82): the server's answer and its later pages,
 * and the last first page it gave. Read again from the start whenever the queue has had an answer
 * — an amendment that moved a spending to another day moves it across the cursor, and only a read
 * from the start puts it where it belongs (MOL-73, Е3) — keeping as many pages as were open.
 */
export function useMoneyMonth(selected: Ref<string>): MoneyMonth {
  const actor = useActorStore()
  const queue = useSpendingQueueStore()
  const trips = useTripQueueStore()
  const accounts = useAccountsStore()

  const shown = ref<Remembered | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const confirmed = ref(false)
  const more = ref<'idle' | 'loading' | 'failed'>('idle')
  const failed = ref(0)
  /** How many pages the person had open, to read that many again after a write lands. */
  let pages = 1

  /** The categories of any month the phone keeps: they are the owner's, not a month's. */
  const kept = ref<MoneyMonthView['categories']>([])
  const keptFrequent = ref<MoneyMonthView['frequent']>([])
  /** Today's rate as the running month last answered it, for a sheet opened on another month. */
  const keptRate = ref<MoneyMonthView['rate']>(null)

  function adopt(): void {
    const id = actor.id
    shown.value = id ? recall(id, selected.value) : null
    kept.value = id ? recallCategories(id) : []
    keptFrequent.value = id ? recallFrequent(id) : []
    keptRate.value = id ? recallTodayRate(id) : null
    // A page asked for on another month is not this month's to fetch (review У-3).
    moreAfterRead = false
    failure.value = null
    confirmed.value = false
    more.value = 'idle'
    pages = 1
  }

  let latest = 0
  let running: Promise<void> | null = null
  /** A next page was asked for while a read from the start was running: asked again after it. */
  let moreAfterRead = false
  let asks = 0

  /** A first page landed: the phone keeps it, and what is the owner's rather than a month's. */
  function keep(id: string, first: MoneyMonthView, firstAt: Date, askedAt: Date): void {
    if (actor.id !== id) return
    // Not over an answer that set out later: it knows more (MOL-262, adversarial А6). A screen left
    // meanwhile, or another window, kept it, and this screen has not seen it — so what is the owner's
    // is taken from the phone, not left as read at the opening (А7).
    if (!remember(id, first, firstAt, askedAt)) {
      kept.value = recallCategories(id)
      keptFrequent.value = recallFrequent(id)
      keptRate.value = recallTodayRate(id)
      return
    }
    // The categories are the owner's, not a month's: an answer of the month just left names them
    // for the one now on screen too — read before it came, that one had none to write a spending
    // into until it was read itself (MOL-183, e2e «a summary that did not load»). Today's rate
    // likewise, from the running month's answer: a spending is written today (MOL-262, А1).
    kept.value = first.categories
    keptFrequent.value = first.frequent
    if (first.rateKind === 'live') keptRate.value = first.rate
  }

  async function ask(id: string, month: string): Promise<void> {
    const mine = ++latest
    const wanted = pages
    const askedAt = new Date()
    try {
      const first = await api.moneyMonth(month)
      // The first page is what is kept, as a first read answers it: the cursor of a later page
      // is the server's to work out, not the phone's.
      const firstAt = new Date()
      keep(id, first, firstAt, askedAt)
      let answer = first
      for (let page = 1; page < wanted && answer.cursor; page++) {
        answer = mergePages(answer, await api.moneyMonth(month, answer.cursor))
      }
      if (actor.id !== id || selected.value !== month || mine !== latest) return
      shown.value = { answer, fetchedAt: firstAt, askedAt }
      kept.value = answer.categories
      keptFrequent.value = answer.frequent
      if (answer.rateKind === 'live') keptRate.value = answer.rate
      failure.value = null
      confirmed.value = true
      more.value = 'idle'
      if (moreAfterRead) {
        moreAfterRead = false
        void loadMore()
      }
    } catch (error) {
      reportFailure(error, 'screen')
      if (actor.id !== id || selected.value !== month || mine !== latest) return
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
      failed.value += 1
    }
  }

  async function load(): Promise<void> {
    if (!actor.id) return
    asks += 1
    if (running) return running
    running = (async () => {
      let served = 0
      while (served !== asks) {
        served = asks
        const id = actor.id
        if (!id) break
        await ask(id, selected.value)
      }
    })().finally(() => {
      running = null
    })
    return running
  }

  async function loadMore(): Promise<void> {
    const current = shown.value
    const id = actor.id
    if (!current?.answer.cursor || !id || more.value === 'loading') return
    const month = selected.value
    const mine = latest
    more.value = 'loading'
    try {
      const next = await api.moneyMonth(month, current.answer.cursor)
      if (actor.id !== id || selected.value !== month) return
      // A read from the start began or landed while this page was on its way: the page continues
      // an answer no longer on screen, and laid over the fresh one it took away the spending just
      // written (adversarial Е). It is asked for again from the answer shown once the read is in.
      if (mine !== latest || shown.value !== current) {
        more.value = 'idle'
        if (running) moreAfterRead = true
        else void loadMore()
        return
      }
      shown.value = { ...current, answer: mergePages(current.answer, next) }
      pages += 1
      more.value = 'idle'
    } catch {
      if (mine === latest && shown.value === current) more.value = 'failed'
    }
  }

  adopt()
  watch([() => actor.id, selected], () => {
    latest += 1
    adopt()
    void load()
  })
  // A trip removed or brought back has moved the month too (MOL-76), and so has a transfer's fee
  // (MOL-253), written beside no queue.
  watch(
    () => [queue.landed, trips.landed, accounts.transfers],
    () => void load(),
  )
  /**
   * Opened on another month, the screen reads the running one too, after its own: today's rate there
   * is that month's answer kept on the phone, and an exchange written meanwhile — on its own screen,
   * which tells «Деньги» nothing — left the sheet the rate from before it (MOL-262, adversarial А5).
   * Its first page alone, and beside the screen's reads: it moves only what is kept, never the month
   * shown or a page on its way (MOL-262, self-review 9).
   */
  async function loadWithToday(): Promise<void> {
    await load()
    const id = actor.id
    const today = monthOf(localDay())
    if (!id || selected.value === today) return
    const askedAt = new Date()
    try {
      keep(id, await api.moneyMonth(today), new Date(), askedAt)
    } catch (error) {
      reportFailure(error, 'screen')
    }
  }
  onMounted(() => void loadWithToday())
  useReconnect(() => void loadWithToday())

  const phase = computed<MoneyPhase>(() => {
    if (!actor.id) return 'idle'
    if (shown.value) return 'ready'
    return failure.value ?? 'loading'
  })

  return {
    phase,
    month: computed(() => shown.value?.answer ?? null),
    stale: computed<MoneyStale | null>(() => {
      if (!shown.value || confirmed.value) return null
      return failure.value ?? 'loading'
    }),
    fetchedAt: computed(() => shown.value?.fetchedAt ?? null),
    attempt: computed(() => failed.value),
    askedAt: computed(() => shown.value?.askedAt ?? shown.value?.fetchedAt ?? null),
    knownCategories: computed(() => shown.value?.answer.categories ?? kept.value),
    categoriesAskedAt: computed(() => shown.value?.askedAt ?? null),
    knownFrequent: computed(() => shown.value?.answer.frequent ?? keptFrequent.value),
    todayRate: computed(() =>
      shown.value?.answer.rateKind === 'live' ? shown.value.answer.rate : keptRate.value,
    ),
    more: computed(() => more.value),
    loadMore,
    retry: load,
  }
}
