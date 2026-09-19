import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { pendingVerdictsCodec } from '@molvia/model'
import type { PendingVerdict, PendingVerdicts } from '@molvia/model'
import { api } from '@/api'
import { useReconnect } from '@/composables/useReconnect'
import { useActorStore } from '@/stores/actor'
import { read, write } from '@/stores/storage'
import { useVerdictDraftsStore } from '@/stores/verdictDrafts'
import type { Score } from '@/stores/verdictDrafts'

/** `idle` — no identity, so no queue to ask for. */
export type QueuePhase = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'offline'

export interface VerdictQueue {
  readonly phase: ComputedRef<QueuePhase>
  readonly cards: ComputedRef<PendingVerdict[]>
  /** Cards the server refused a rating for: back in the queue, first. */
  readonly returned: ComputedRef<PendingVerdict[]>
  /** The card on screen, or none when there is nothing to rate. */
  readonly current: ComputedRef<PendingVerdict | null>
  /** How many items wait, for the line under the title. */
  readonly count: ComputedRef<number>
  /** The cards come from memory: the last load failed, without a connection or with one. */
  readonly stale: ComputedRef<'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  save(card: PendingVerdict, score: Score, review: string): void
  skip(card: PendingVerdict): void
  retry(): Promise<void>
}

const ANSWER_KEY = 'molvia.verdict-queue'
const SKIPS_KEY = 'molvia.verdict-skips'

interface Remembered {
  readonly answer: PendingVerdicts
  /** When it was asked for: a rating confirmed later may not be in it yet. */
  readonly askedAt: Date
  readonly fetchedAt: Date
}

/** A card put off with «Не сейчас», and the purchase it was put off at (MOL-28, В-3). */
interface Skip {
  readonly itemId: string
  readonly boughtAt: string
}

function recallAnswer(key: string): Remembered | null {
  const raw = read(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { answer?: unknown; askedAt?: unknown; fetchedAt?: unknown }
    const answer = pendingVerdictsCodec.safeParse(parsed.answer)
    const fetchedAt = dateOf(parsed.fetchedAt)
    // A memory written before `askedAt` was kept: its answer is at least as old as it arrived.
    const askedAt = dateOf(parsed.askedAt) ?? fetchedAt
    if (!answer.success || !askedAt || !fetchedAt) return null
    return { answer: answer.data, askedAt, fetchedAt }
  } catch {
    return null
  }
}

function dateOf(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function recallSkips(key: string): Skip[] {
  const raw = read(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (skip): skip is Skip =>
        typeof skip === 'object' &&
        skip !== null &&
        typeof (skip as Skip).itemId === 'string' &&
        typeof (skip as Skip).boughtAt === 'string',
    )
  } catch {
    return []
  }
}

/**
 * The queue of «Оценки»: what the server says waits for a verdict, as this phone sees it
 * (MOL-28). The server's order stands, with three corrections that only the phone knows about:
 *
 * - an item with a saved draft is not shown — the server still counts it, the person is done;
 * - a draft the server refused comes back first, with the person's words;
 * - «Не сейчас» moves a card behind the others until the item is bought again (В-3). Put off
 *   everything, and the cards come round again: «Всё оценено» would be a lie.
 *
 * The last answer is kept on the phone (В-4), so a queue opened without a connection still
 * has something to rate, marked as not fresh.
 */
export function useVerdictQueue(): VerdictQueue {
  const actor = useActorStore()
  const drafts = useVerdictDraftsStore()

  /** Whose queue is held here. Everything below is written under this id and nobody else's. */
  const owner = ref<string | null>(null)
  const remembered = ref<Remembered | null>(null)
  const skips = ref<Skip[]>([])
  const failure = ref<'offline' | 'error' | null>(null)
  /** The card on screen stays put while the person is on it, whatever a reload brings. */
  const shownId = ref<string | null>(null)

  function recall(id: string | null): void {
    owner.value = id
    remembered.value = id ? recallAnswer(`${ANSWER_KEY}.${id}`) : null
    skips.value = id ? recallSkips(`${SKIPS_KEY}.${id}`) : []
    failure.value = null
    shownId.value = null
  }

  function rememberAnswer(): void {
    if (!owner.value || !remembered.value) return
    const { answer, askedAt, fetchedAt } = remembered.value
    write(
      `${ANSWER_KEY}.${owner.value}`,
      JSON.stringify({
        answer: pendingVerdictsCodec.encode(answer),
        askedAt: askedAt.toISOString(),
        fetchedAt: fetchedAt.toISOString(),
      }),
    )
  }

  function rememberSkips(): void {
    if (owner.value) write(`${SKIPS_KEY}.${owner.value}`, JSON.stringify(skips.value))
  }

  function without(answer: PendingVerdicts, gone: ReadonlySet<string>): PendingVerdicts {
    const items = answer.items.filter((card) => !gone.has(card.itemId))
    const total = Math.max(items.length, answer.total - (answer.items.length - items.length))
    return { items, total }
  }

  /**
   * The remembered answer, less what was rated after it was asked for: the server may have read
   * the queue before it wrote the verdict, and whoever sent it — this screen or the app while
   * the screen was closed — left the moment in `drafts.confirmed` (adversarial F1, R1). Read
   * every time, never cut out of the memory, so the order of the two answers does not matter.
   */
  const answer = computed<PendingVerdicts | null>(() => {
    const shown = remembered.value
    if (!shown) return null
    const asked = shown.askedAt.getTime()
    const rated = new Set(
      Object.entries(drafts.confirmed)
        .filter(([, at]) => at >= asked)
        .map(([itemId]) => itemId),
    )
    return without(shown.answer, rated)
  })

  const returned = computed(() =>
    Object.values(drafts.drafts)
      .filter((draft) => draft.state === 'typing' && draft.error !== null)
      .map((draft) => draft.card),
  )

  /** Put off at this purchase and not bought since. A new purchase asks again. */
  function isSkipped(card: PendingVerdict): boolean {
    const skip = skips.value.find((entry) => entry.itemId === card.itemId)
    return skip !== undefined && card.boughtAt.getTime() <= new Date(skip.boughtAt).getTime()
  }

  const cards = computed<PendingVerdict[]>(() => {
    const listed = answer.value?.items ?? []
    const sending = new Set(drafts.waiting.map((draft) => draft.card.itemId))
    const back = new Set(returned.value.map((card) => card.itemId))
    const open = listed.filter((card) => !sending.has(card.itemId) && !back.has(card.itemId))
    // A card the server refused comes first — and can still be put off like any other.
    const all = [...returned.value, ...open]

    const skippedLast = skips.value
      .map((skip) => all.find((card) => card.itemId === skip.itemId))
      .filter((card): card is PendingVerdict => card !== undefined && isSkipped(card))
    const later = new Set(skippedLast.map((card) => card.itemId))

    return [...all.filter((card) => !later.has(card.itemId)), ...skippedLast]
  })

  const current = computed<PendingVerdict | null>(
    () => cards.value.find((card) => card.itemId === shownId.value) ?? cards.value[0] ?? null,
  )
  watch(
    current,
    (card) => {
      shownId.value = card?.itemId ?? null
    },
    { immediate: true },
  )

  /**
   * For the counter under the title: what the server counts, less what is on its way. A draft on
   * the page is still counted by the server; one off the page is only when the page is not the
   * whole queue — otherwise it is off the page because the server already has it (adversarial
   * F3, R2). Never fewer than the cards on screen. On a partial page the two cannot be told
   * apart from one answer, and a rating whose answer was lost is subtracted twice until it is
   * sent again — a known limit, off by one, over fifty waiting (adversarial G3).
   */
  const count = computed(() => {
    const shown = answer.value
    if (!shown) return 0
    const listed = new Set(shown.items.map((card) => card.itemId))
    const partial = shown.total > shown.items.length
    const onTheirWay = drafts.waiting.filter(
      (draft) => listed.has(draft.card.itemId) || partial,
    ).length
    return Math.max(cards.value.length, shown.total - onTheirWay)
  })

  const phase = computed<QueuePhase>(() => {
    // No identity, nothing to ask for: the identity notice above says why (adversarial F4).
    if (!actor.id) return 'idle'
    if (cards.value.length > 0) return 'ready'
    // Nothing to show and no fresh answer: not a success — the list could not be read. Unless
    // the person emptied it themselves, and a rating is on its way: then that is the news
    // (adversarial R4).
    if (failure.value && drafts.waiting.length === 0) return failure.value
    return remembered.value ? 'empty' : 'loading'
  })

  /** Shown from memory because a fresh answer could not be had — and why. */
  const stale = computed(() => (remembered.value === null ? null : failure.value))
  const fetchedAt = computed(() => remembered.value?.fetchedAt ?? null)

  /** Forgets what was put off about items the server no longer lists — rated, or withdrawn. */
  function pruneSkips(answer: PendingVerdicts): void {
    if (answer.total > answer.items.length) return
    const listed = new Set(answer.items.map((card) => card.itemId))
    const kept = skips.value.filter((skip) => listed.has(skip.itemId))
    if (kept.length === skips.value.length) return
    skips.value = kept
    rememberSkips()
  }

  let loadingFor: string | null = null

  async function load(): Promise<void> {
    const id = actor.id
    if (!id || loadingFor === id) return
    loadingFor = id
    const askedAt = new Date()
    try {
      const fresh = await api.pendingVerdicts()
      if (owner.value !== id) return
      remembered.value = { answer: fresh, askedAt, fetchedAt: new Date() }
      failure.value = null
      rememberAnswer()
      // What was confirmed before this was asked for, the answer already knows.
      drafts.settle(askedAt)
      if (answer.value) pruneSkips(answer.value)
    } catch {
      if (owner.value !== id) return
      // Decided after the failure: a connection lost while the answer was on its way is not
      // the server's fault, and is never drawn red.
      failure.value = navigator.onLine ? 'error' : 'offline'
    } finally {
      if (loadingFor === id) loadingFor = null
    }
  }

  /** «Сохранить оценку»: the draft is kept and the next card is there at once. */
  function save(card: PendingVerdict, score: Score, review: string): void {
    // Rated, so no longer put off: were it refused, it comes back first, not last.
    if (skips.value.some((entry) => entry.itemId === card.itemId)) {
      skips.value = skips.value.filter((entry) => entry.itemId !== card.itemId)
      rememberSkips()
    }
    drafts.save(card, score, review)
    shownId.value = null
  }

  /** «Не сейчас»: behind the others, until the item is bought again. */
  function skip(card: PendingVerdict): void {
    skips.value = [
      ...skips.value.filter((entry) => entry.itemId !== card.itemId),
      { itemId: card.itemId, boughtAt: card.boughtAt.toISOString() },
    ]
    rememberSkips()
    shownId.value = null
  }

  recall(actor.id)
  watch(
    () => actor.id,
    (id) => {
      recall(id)
      void load()
    },
  )
  onMounted(() => void load())
  useReconnect(() => void load())

  return { phase, cards, returned, current, count, stale, fetchedAt, save, skip, retry: load }
}
