import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { adviceResponseSchema, geographyKey } from '@molvia/model'
import type { AdviceResponse, AdviceRow, AdviceScope } from '@molvia/model'
import { api } from '@/api'
import type { CheapRow, NeverRow, TakeRow } from '@/components/adviceRow'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { read, write } from '@/stores/storage'

/** `idle` — no identity, so there is nobody to advise. */
export type AdvicePhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'offline'

/**
 * The rows of one answer, split by verdict — the shape the screen draws. Each group carries
 * its own kind of row, so a card that prints a price cannot be handed a row that has none:
 * the product's rule is held by the type checker here too, not only on the wire.
 */
export interface AdviceGroups {
  readonly take: TakeRow[]
  readonly if_cheap: CheapRow[]
  readonly never: NeverRow[]
}

export interface Advice {
  readonly phase: ComputedRef<AdvicePhase>
  /** Whose figures the rows carry. The screen cannot work it out, and must say it in words. */
  readonly scope: ComputedRef<AdviceScope | null>
  readonly groups: ComputedRef<AdviceGroups>
  /** How many rows are on the screen, and how many there are in all — «Показаны 200 из 340». */
  readonly shown: ComputedRef<number>
  readonly total: ComputedRef<number>
  /**
   * The rows come from the phone rather than from an answer of this session, and why: a
   * request still on its way, no connection, or a server that broke.
   */
  readonly stale: ComputedRef<Stale | null>
  readonly fetchedAt: ComputedRef<Date | null>
  retry(): Promise<void>
}

/** Why the list on the screen is not an answer of this session (MOL-32, А4). */
export type Stale = 'loading' | 'offline' | 'error'

const KEY = 'molvia.advice'

interface Remembered {
  readonly answer: AdviceResponse
  readonly fetchedAt: Date
}

function recall(key: string): Remembered | null {
  const raw = read(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown; fetchedAt?: unknown }
    const answer = adviceResponseSchema.safeParse(parsed.answer)
    const fetchedAt =
      typeof parsed.fetchedAt === 'string' ? new Date(parsed.fetchedAt) : new Date(Number.NaN)
    if (!answer.success || Number.isNaN(fetchedAt.getTime())) return null
    return { answer: answer.data, fetchedAt }
  } catch {
    return null
  }
}

function split(rows: readonly AdviceRow[]): AdviceGroups {
  const take: TakeRow[] = []
  const if_cheap: CheapRow[] = []
  const never: NeverRow[] = []
  // No sorting: the server orders by rating down, and the levels are decided by that same
  // printed tenth, so the three groups already lie in the answer one after another (Р-22).
  for (const row of rows) {
    if (row.level === 'take') take.push(row)
    else if (row.level === 'if_cheap') if_cheap.push(row)
    else never.push(row)
  }
  return { take, if_cheap, never }
}

/**
 * «Что брать» as this phone sees it (MOL-32): the server's answer, and the last one it gave.
 *
 * The memory is not about speed. Offline the screen has to name the age of what it shows —
 * «список на вчера в 21:40» is what a person judges by, «данные могут быть неактуальны» is
 * not — and it can name it only if it kept the answer. Verdicts are worked out on the server
 * and there is nothing on the phone to compute them from, so the choice is the remembered
 * list or an empty screen at the shelf (В-5).
 *
 * A remembered list outranks a failure: while there is something to show, offline is a strip
 * above the rows, not a screen of its own (Р-5).
 */
export function useAdvice(): Advice {
  const actor = useActorStore()

  /** Whose answer is held here. Nothing is read or written under anyone else's id. */
  const owner = ref<string | null>(null)
  const remembered = ref<Remembered | null>(null)
  const failure = ref<'offline' | 'error' | null>(null)
  /** Whether what is shown came from an answer of this session, rather than from the phone. */
  const confirmed = ref(false)

  const location = computed(() => (actor.settings ? geographyKey(actor.settings) : null))

  function adopt(id: string | null): void {
    owner.value = id
    const cached = id ? recall(`${KEY}.${id}`) : null
    remembered.value =
      cached && geographyKey(cached.answer.geography) === location.value ? cached : null
    failure.value = null
    confirmed.value = false
  }

  function remember(): void {
    if (!owner.value || !remembered.value) return
    const { answer, fetchedAt } = remembered.value
    write(
      `${KEY}.${owner.value}`,
      JSON.stringify({
        answer: adviceResponseSchema.encode(answer),
        fetchedAt: fetchedAt.toISOString(),
      }),
    )
  }

  const rows = computed<AdviceRow[]>(() => remembered.value?.answer.rows ?? [])

  const phase = computed<AdvicePhase>(() => {
    // No identity, nothing to ask for: `IdentityNotice` above the content says why.
    if (!actor.id) return 'idle'
    if (remembered.value) return rows.value.length > 0 ? 'ready' : 'empty'
    if (failure.value) return failure.value
    return 'loading'
  })

  /**
   * One request at a time, and only the newest may be written down.
   *
   * `running` used to be an identifier, and a second call for the same person simply returned
   * — but `retry` is this same function, so a save that happened while a refresh was in the
   * air updated nothing and the screen kept the figures the older answer brought (А3). And
   * two changes of identity, A → B → A, slipped two requests for A past that guard: the
   * slower one landed last and overwrote the fresher list, on the screen and on the phone
   * alike (А6). So an ask that arrives while a request is in the air is remembered rather
   * than dropped, and every answer carries the number of the request that asked for it.
   */
  let running: object | null = null
  let latest = 0
  /** How many times a fresh list has been asked for; the loop below serves the last ask. */
  let asks = 0

  async function ask(id: string): Promise<void> {
    const mine = ++latest
    const where = location.value
    try {
      const fresh = await api.advice()
      if (owner.value !== id || mine !== latest || location.value !== where) return
      // The server names the geography it actually used; a second device may have moved it.
      if (location.value && geographyKey(fresh.geography) !== location.value) {
        const loaded = await api.me()
        if (owner.value !== id || mine !== latest || loaded.id !== id) return
        actor.apply(loaded)
        return
      }
      remembered.value = { answer: fresh, fetchedAt: new Date() }
      failure.value = null
      confirmed.value = true
      remember()
    } catch {
      if (owner.value !== id || mine !== latest || location.value !== where) return
      // Decided after the failure, never narrowed from a check before the request: a
      // connection lost while the answer was on its way is the commonest break at a shelf,
      // and it is not the server's fault and never red.
      failure.value = navigator.onLine ? 'error' : 'offline'
    }
  }

  async function load(): Promise<void> {
    if (!actor.id) return
    asks += 1
    if (running) return
    const token = {}
    running = token
    try {
      let served = 0
      while (served !== asks) {
        served = asks
        // Read afresh every round: the identity may have changed while the last answer was on
        // its way, and the next request belongs to whoever the person is now.
        const id = actor.id
        if (!id) break
        await ask(id)
        if (running !== token) break
      }
    } finally {
      if (running === token) running = null
    }
  }

  adopt(actor.id)
  watch(
    () => [actor.id, location.value],
    () => {
      latest += 1
      running = null
      adopt(actor.id)
      void load()
    },
  )
  onMounted(() => void load())
  useReconnect(() => void load())

  return {
    phase,
    scope: computed(() => remembered.value?.answer.scope ?? null),
    groups: computed(() => split(rows.value)),
    shown: computed(() => rows.value.length),
    total: computed(() => remembered.value?.answer.total ?? 0),
    /**
     * Nothing to say when the list came from this session's own answer. Otherwise the reason
     * it did not: a request still in the air is one of them — the same yesterday's prices
     * looked freshly loaded until the failure arrived (А4).
     */
    stale: computed<Stale | null>(() => {
      if (remembered.value === null || confirmed.value) return null
      return failure.value ?? 'loading'
    }),
    fetchedAt: computed(() => remembered.value?.fetchedAt ?? null),
    retry: load,
  }
}
