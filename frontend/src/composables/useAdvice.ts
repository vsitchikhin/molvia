import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { adviceResponseSchema } from '@molvia/model'
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
  /** The rows come from memory: the last load failed, without a connection or with one. */
  readonly stale: ComputedRef<'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  retry(): Promise<void>
}

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

  function adopt(id: string | null): void {
    owner.value = id
    remembered.value = id ? recall(`${KEY}.${id}`) : null
    failure.value = null
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

  let loadingFor: string | null = null

  async function load(): Promise<void> {
    const id = actor.id
    if (!id || loadingFor === id) return
    loadingFor = id
    try {
      const fresh = await api.advice()
      if (owner.value !== id) return
      remembered.value = { answer: fresh, fetchedAt: new Date() }
      failure.value = null
      remember()
    } catch {
      if (owner.value !== id) return
      // Decided after the failure, never narrowed from a check before the request: a
      // connection lost while the answer was on its way is the commonest break at a shelf,
      // and it is not the server's fault and never red.
      failure.value = navigator.onLine ? 'error' : 'offline'
    } finally {
      if (loadingFor === id) loadingFor = null
    }
  }

  adopt(actor.id)
  watch(
    () => actor.id,
    (id) => {
      adopt(id)
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
    stale: computed(() => (remembered.value === null ? null : failure.value)),
    fetchedAt: computed(() => remembered.value?.fetchedAt ?? null),
    retry: load,
  }
}
