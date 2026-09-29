import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { moneyChartsCodec } from '@molvia/model'
import type { MoneyChartsView } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { isRecord } from '@/stores/queueing'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { read, write } from '@/stores/storage'

/** `idle` — no identity, so there are no charts to read. */
export type ChartsPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

export interface MoneyChartsState {
  readonly phase: ComputedRef<ChartsPhase>
  readonly charts: ComputedRef<MoneyChartsView | null>
  /** Why the charts on screen are not an answer of this visit — the last one kept, and its age. */
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  readonly retry: () => Promise<void>
}

/**
 * The last answer of each period, per owner (handoff 04, Р-11): offline the charts are the ones of
 * the last connection with a strip saying when. Read back through the strict codec — a change of the
 * contract empties it. `molvia.charts.<owner>` goes with the rest of the drawer on «Выйти».
 */
const KEY = 'molvia.charts'

interface Remembered {
  readonly answer: MoneyChartsView
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

function recall(owner: string, period: number): Remembered | null {
  const kept = recallAll(owner)[String(period)]
  if (!isRecord(kept)) return null
  const answer = moneyChartsCodec.safeParse(kept.answer)
  const fetchedAt = typeof kept.fetchedAt === 'string' ? new Date(kept.fetchedAt) : null
  if (!answer.success || !fetchedAt || Number.isNaN(fetchedAt.getTime())) return null
  return { answer: answer.data, fetchedAt }
}

function remember(owner: string, answer: MoneyChartsView, fetchedAt: Date): void {
  const all = recallAll(owner)
  all[String(answer.period)] = {
    answer: moneyChartsCodec.encode(answer),
    fetchedAt: fetchedAt.toISOString(),
  }
  write(`${KEY}.${owner}`, JSON.stringify(all))
}

/**
 * «Графики» as this phone sees them (MOL-74): the server's answer for the period, the last one kept
 * while a new one is on its way or cannot come, and read again whenever a write of «Деньги» or of a
 * trip has landed — the months move with them. Offline or error is decided after the failure
 * (MOL-19, A1); an answer about another period or another owner than the one now shown is dropped.
 */
export function useMoneyCharts(period: Ref<6 | 12>): MoneyChartsState {
  const actor = useActorStore()
  const spendings = useSpendingQueueStore()
  const trips = useTripQueueStore()

  const shown = ref<Remembered | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  const confirmed = ref(false)
  let latest = 0
  /** The latest read of each period that came back with an answer. */
  const answered = new Map<number, number>()

  function adopt(): void {
    const id = actor.id
    shown.value = id ? recall(id, period.value) : null
    failure.value = null
    confirmed.value = false
  }

  async function load(): Promise<void> {
    const id = actor.id
    if (!id) return
    const asked = period.value
    const mine = ++latest
    try {
      const answer = await api.moneyCharts(asked)
      const fetchedAt = new Date()
      // An answer older than one already in is dropped: it would put the charts without the spending
      // just written on the phone, under a later hour (adversarial Б, d9 Д). One whose later read is
      // still on its way, or failed, is the freshest there is and is kept (d9 round 2 Е2).
      if (mine < (answered.get(asked) ?? 0)) return
      answered.set(asked, mine)
      if (actor.id === id) remember(id, answer, fetchedAt)
      if (actor.id !== id || period.value !== asked) return
      shown.value = { answer, fetchedAt }
      failure.value = null
      confirmed.value = true
    } catch {
      if (actor.id !== id || period.value !== asked || mine !== latest) return
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  adopt()
  watch([() => actor.id, period], () => {
    adopt()
    void load()
  })
  watch(
    () => [spendings.landed, trips.landed],
    () => void load(),
  )
  onMounted(() => void load())
  useReconnect(() => void load())

  return {
    phase: computed<ChartsPhase>(() => {
      if (!actor.id) return 'idle'
      if (shown.value) return 'ready'
      return failure.value ?? 'loading'
    }),
    charts: computed(() => shown.value?.answer ?? null),
    stale: computed(() => {
      if (!shown.value || confirmed.value) return null
      return failure.value ?? 'loading'
    }),
    fetchedAt: computed(() => shown.value?.fetchedAt ?? null),
    retry: load,
  }
}
