import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { z } from 'zod'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { isRecord } from '@/stores/queueing'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'
import { read, write } from '@/stores/storage'

/** `idle` — no identity, so there is nothing to read. */
export type KeptPhase = 'idle' | 'loading' | 'ready' | 'error' | 'offline'

export interface KeptAnswer<T> {
  readonly phase: ComputedRef<KeptPhase>
  readonly answer: ComputedRef<T | null>
  /** Why the answer on screen is not one of this visit — the last one kept, and its age. */
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  /**
   * Every answer kept on this phone for the owner, of any subject, with when it was read — what the
   * device knows beyond the subject shown (MOL-160, adversarial Ж′), and how fresh (adversarial Л).
   */
  readonly kept: ComputedRef<readonly Remembered<T>[]>
  readonly retry: () => Promise<void>
  /**
   * An answer a write came back with (MOL-117, review 6): the latest there is for its subject, kept
   * and shown as a read's would be — no second read for what the write already said.
   */
  readonly accept: (subject: string, answer: T) => void
}

export interface KeptAnswerOptions<T> {
  /** `molvia.<name>`: kept per owner as `<key>.<owner>`, so «Выйти» takes it with the drawer. */
  readonly key: string
  /** What is asked — a period, a month: one answer is kept for each. */
  readonly subject: Ref<string>
  readonly ask: (subject: string) => Promise<T>
  /** Read back strictly: a change of the contract empties what was kept. */
  readonly codec: z.ZodType<T>
  /** How many subjects are kept, the newest read; every one when not named. */
  readonly kept?: number
}

export interface Remembered<T> {
  readonly answer: T
  readonly fetchedAt: Date
}

/**
 * An answer of «Графики» as this phone sees it (MOL-74, MOL-158): the server's for the subject, the
 * last one kept while a new one is on its way or cannot come, and read again whenever a write of
 * «Деньги» or of a trip has landed. Offline or error is decided after the failure (MOL-19, A1); an
 * answer about another subject or another owner than the one now shown is dropped. **Only the latest
 * read is kept** (adversarial Б, d9 Д of MOL-74): an earlier one answering late is dropped; one whose
 * later read is still on its way, or failed, is the freshest there is and is kept (d9 round 2 Е2) —
 * under the strip, when that later read failed (review С-10).
 */
export function useKeptAnswer<T>(options: KeptAnswerOptions<T>): KeptAnswer<T> {
  const { key, subject, ask, codec, kept } = options
  const actor = useActorStore()
  const spendings = useSpendingQueueStore()
  const trips = useTripQueueStore()

  function recallAll(owner: string): Record<string, unknown> {
    const raw = read(`${key}.${owner}`)
    if (!raw) return {}
    try {
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  function recall(owner: string, asked: string): Remembered<T> | null {
    const one = recallAll(owner)[asked]
    if (!isRecord(one)) return null
    const answer = codec.safeParse(one.answer)
    const fetchedAt = typeof one.fetchedAt === 'string' ? new Date(one.fetchedAt) : null
    if (!answer.success || !fetchedAt || Number.isNaN(fetchedAt.getTime())) return null
    return { answer: answer.data, fetchedAt }
  }

  function remember(owner: string, asked: string, answer: T, fetchedAt: Date): void {
    const all = recallAll(owner)
    all[asked] = { answer: codec.encode(answer), fetchedAt: fetchedAt.toISOString() }
    const newest =
      kept === undefined
        ? all
        : Object.fromEntries(
            Object.entries(all)
              .flatMap(([name, value]) =>
                isRecord(value) && typeof value.fetchedAt === 'string'
                  ? [{ name, value, at: value.fetchedAt }]
                  : [],
              )
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, kept)
              .map(({ name, value }) => [name, value]),
          )
    write(`${key}.${owner}`, JSON.stringify(newest))
  }

  const shown = shallowRef<Remembered<T> | null>(null)
  /** Every answer kept for the owner, read again whenever what is kept may have changed. */
  const stored = shallowRef<readonly Remembered<T>[]>([])
  function recallKept(): void {
    const id = actor.id
    stored.value = id
      ? Object.keys(recallAll(id)).flatMap((name) => {
          const one = recall(id, name)
          return one ? [one] : []
        })
      : []
  }
  const failure = ref<'offline' | 'error' | null>(null)
  const confirmed = ref(false)
  let latest = 0
  /** The latest read of each subject that came back with an answer, and that came back with none. */
  const answered = new Map<string, number>()
  const failed = new Map<string, number>()

  function adopt(): void {
    const id = actor.id
    shown.value = id ? recall(id, subject.value) : null
    recallKept()
    failure.value = null
    confirmed.value = false
  }

  async function load(): Promise<void> {
    const id = actor.id
    if (!id) return
    const asked = subject.value
    const mine = ++latest
    try {
      const answer = await ask(asked)
      const fetchedAt = new Date()
      // An answer older than one already in is dropped: it would put the charts without the spending
      // just written on the phone, under a later hour (adversarial Б, d9 Д). One whose later read is
      // still on its way, or failed, is the freshest there is and is kept (d9 round 2 Е2).
      if (mine < (answered.get(asked) ?? 0)) return
      answered.set(asked, mine)
      if (actor.id === id) {
        remember(id, asked, answer, fetchedAt)
        recallKept()
      }
      if (actor.id !== id || subject.value !== asked) return
      shown.value = { answer, fetchedAt }
      // A later read already failed: this answer is older than what the phone knows it wrote, so it
      // stays under the strip, with its hour (review С-10).
      if (mine < (failed.get(asked) ?? 0)) return
      failure.value = null
      confirmed.value = true
    } catch {
      failed.set(asked, Math.max(mine, failed.get(asked) ?? 0))
      if (actor.id !== id || subject.value !== asked || mine !== latest) return
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  function accept(asked: string, answer: T): void {
    const id = actor.id
    if (!id) return
    const mine = ++latest
    answered.set(asked, mine)
    const fetchedAt = new Date()
    remember(id, asked, answer, fetchedAt)
    recallKept()
    if (subject.value !== asked) return
    shown.value = { answer, fetchedAt }
    failure.value = null
    confirmed.value = true
  }

  adopt()
  watch([() => actor.id, subject], () => {
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
    phase: computed<KeptPhase>(() => {
      if (!actor.id) return 'idle'
      if (shown.value) return 'ready'
      return failure.value ?? 'loading'
    }),
    answer: computed(() => shown.value?.answer ?? null),
    stale: computed(() => {
      if (!shown.value || confirmed.value) return null
      return failure.value ?? 'loading'
    }),
    fetchedAt: computed(() => shown.value?.fetchedAt ?? null),
    kept: computed(() => stored.value),
    retry: load,
    accept,
  }
}
