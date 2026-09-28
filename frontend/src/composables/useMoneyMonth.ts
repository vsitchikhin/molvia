import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { monthOf, moneyMonthCodec, yerevanDate } from '@molvia/model'
import type { MoneyMonthView } from '@molvia/model'
import { api } from '@/api'
import { mergePages } from '@/components/spending'
import { useReconnect } from '@/composables/useReconnect'
import { isRecord } from '@/stores/queueing'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { read, write } from '@/stores/storage'

/** `idle` — no identity, so there is no month to read. */
export type MoneyPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

/** Why the month on screen is not an answer of this session. */
export type MoneyStale = 'loading' | 'offline' | 'error'

export interface MoneyMonth {
  readonly phase: ComputedRef<MoneyPhase>
  readonly month: ComputedRef<MoneyMonthView | null>
  readonly stale: ComputedRef<MoneyStale | null>
  readonly fetchedAt: ComputedRef<Date | null>
  /** The owner's categories: this month's answer's, or those of the newest month kept. */
  readonly knownCategories: ComputedRef<MoneyMonthView['categories']>
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
 * screen (handoff 04). Read back through the strict codec — a change of the contract empties it.
 */
const KEY = 'molvia.money'
const KEPT_MONTHS = 3

interface Remembered {
  readonly answer: MoneyMonthView
  readonly fetchedAt: Date
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
  return { answer: answer.data, fetchedAt }
}

/** The categories of the newest month kept for the owner — any month names all of them. */
export function recallCategories(owner: string): MoneyMonthView['categories'] {
  const newest = Object.keys(recallAll(owner))
    .map((month) => recall(owner, month))
    .filter((one): one is Remembered => one !== null)
    .sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0]
  return newest?.answer.categories ?? []
}

/** The rate of the running month as last answered — only a month read while it was running. */
function recallTodayRate(owner: string): MoneyMonthView['rate'] {
  const today = monthOf(yerevanDate(new Date()))
  const running = recall(owner, today)
  return running?.answer.rateKind === 'live' ? running.answer.rate : null
}

function remember(owner: string, answer: MoneyMonthView, fetchedAt: Date): void {
  const all = recallAll(owner)
  all[answer.month] = {
    answer: moneyMonthCodec.encode(answer),
    fetchedAt: fetchedAt.toISOString(),
  }
  const newest = Object.entries(all)
    .flatMap(([month, value]) =>
      isRecord(value) && typeof value.fetchedAt === 'string'
        ? [{ month, value, at: value.fetchedAt }]
        : [],
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, KEPT_MONTHS)
    .map(({ month, value }) => [month, value])
  write(`${KEY}.${owner}`, JSON.stringify(Object.fromEntries(newest)))
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

  const shown = ref<Remembered | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const confirmed = ref(false)
  const more = ref<'idle' | 'loading' | 'failed'>('idle')
  /** How many pages the person had open, to read that many again after a write lands. */
  let pages = 1

  /** The categories of any month the phone keeps: they are the owner's, not a month's. */
  const kept = ref<MoneyMonthView['categories']>([])
  /** Today's rate as the running month last answered it, for a sheet opened on another month. */
  const keptRate = ref<MoneyMonthView['rate']>(null)

  function adopt(): void {
    const id = actor.id
    shown.value = id ? recall(id, selected.value) : null
    kept.value = id ? recallCategories(id) : []
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

  async function ask(id: string, month: string): Promise<void> {
    const mine = ++latest
    const wanted = pages
    try {
      const first = await api.moneyMonth(month)
      // The first page is what is kept, as a first read answers it: the cursor of a later page
      // is the server's to work out, not the phone's.
      const firstAt = new Date()
      if (actor.id === id) remember(id, first, firstAt)
      let answer = first
      for (let page = 1; page < wanted && answer.cursor; page++) {
        answer = mergePages(answer, await api.moneyMonth(month, answer.cursor))
      }
      if (actor.id !== id || selected.value !== month || mine !== latest) return
      shown.value = { answer, fetchedAt: firstAt }
      kept.value = answer.categories
      if (answer.rateKind === 'live') keptRate.value = answer.rate
      failure.value = null
      confirmed.value = true
      more.value = 'idle'
      if (moreAfterRead) {
        moreAfterRead = false
        void loadMore()
      }
    } catch {
      if (actor.id !== id || selected.value !== month || mine !== latest) return
      // Decided after the failure, never before the request (MOL-19, A1).
      failure.value = navigator.onLine ? 'error' : 'offline'
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
      shown.value = { answer: mergePages(current.answer, next), fetchedAt: current.fetchedAt }
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
  // A trip removed or brought back has moved the month too (MOL-76).
  watch(
    () => [queue.landed, trips.landed],
    () => void load(),
  )
  onMounted(() => void load())
  useReconnect(() => void load())

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
    knownCategories: computed(() => shown.value?.answer.categories ?? kept.value),
    todayRate: computed(() =>
      shown.value?.answer.rateKind === 'live' ? shown.value.answer.rate : keptRate.value,
    ),
    more: computed(() => more.value),
    loadMore,
    retry: load,
  }
}
