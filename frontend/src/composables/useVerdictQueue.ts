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

export type QueuePhase = 'loading' | 'ready' | 'empty' | 'error' | 'offline'

export interface VerdictQueue {
  readonly phase: ComputedRef<QueuePhase>
  readonly cards: ComputedRef<PendingVerdict[]>
  /** The card on screen, or none when there is nothing to rate. */
  readonly current: ComputedRef<PendingVerdict | null>
  /** How many items wait, for the line under the title. */
  readonly count: ComputedRef<number>
  /** The cards come from memory: the last load failed. */
  readonly stale: ComputedRef<boolean>
  readonly fetchedAt: ComputedRef<Date | null>
  save(card: PendingVerdict, score: Score, review: string): void
  skip(card: PendingVerdict): void
  retry(): Promise<void>
}

const ANSWER_KEY = 'molvia.verdict-queue'
const SKIPS_KEY = 'molvia.verdict-skips'

interface Remembered {
  readonly answer: PendingVerdicts
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
    const parsed = JSON.parse(raw) as { answer?: unknown; fetchedAt?: unknown }
    const answer = pendingVerdictsCodec.safeParse(parsed.answer)
    const fetchedAt = typeof parsed.fetchedAt === 'string' ? new Date(parsed.fetchedAt) : null
    if (!answer.success || !fetchedAt || Number.isNaN(fetchedAt.getTime())) return null
    return { answer: answer.data, fetchedAt }
  } catch {
    return null
  }
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

  const remembered = ref<Remembered | null>(null)
  const skips = ref<Skip[]>([])
  const loading = ref(false)
  const failure = ref<'offline' | 'error' | null>(null)
  /** The card on screen stays put while the person is on it, whatever a reload brings. */
  const shownId = ref<string | null>(null)

  function recall(id: string | null): void {
    remembered.value = id ? recallAnswer(`${ANSWER_KEY}.${id}`) : null
    skips.value = id ? recallSkips(`${SKIPS_KEY}.${id}`) : []
    failure.value = null
    shownId.value = null
  }

  function rememberAnswer(): void {
    const id = actor.id
    if (!id || !remembered.value) return
    const { answer, fetchedAt } = remembered.value
    write(
      `${ANSWER_KEY}.${id}`,
      JSON.stringify({
        answer: pendingVerdictsCodec.encode(answer),
        fetchedAt: fetchedAt.toISOString(),
      }),
    )
  }

  function rememberSkips(): void {
    if (actor.id) write(`${SKIPS_KEY}.${actor.id}`, JSON.stringify(skips.value))
  }

  /**
   * A draft that left the waiting list and is not back on a card was answered: the item is
   * rated, and the remembered answer must stop offering it before the next load says so.
   */
  watch(
    () => drafts.waiting.map((draft) => draft.card.itemId),
    (now, before) => {
      const shown = remembered.value
      if (!shown) return
      const { answer } = shown
      const done = before.filter((id) => !now.includes(id) && !(id in drafts.drafts))
      const items = answer.items.filter((card) => !done.includes(card.itemId))
      if (items.length === answer.items.length) return
      const total = Math.max(0, answer.total - (answer.items.length - items.length))
      remembered.value = { ...shown, answer: { items, total } }
      rememberAnswer()
    },
  )

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
    const listed = remembered.value?.answer.items ?? []
    const sending = new Set(drafts.waiting.map((draft) => draft.card.itemId))
    const back = new Set(returned.value.map((card) => card.itemId))
    const open = listed.filter((card) => !sending.has(card.itemId) && !back.has(card.itemId))

    const skippedLast = skips.value
      .map((skip) => open.find((card) => card.itemId === skip.itemId))
      .filter((card): card is PendingVerdict => card !== undefined && isSkipped(card))
    const later = new Set(skippedLast.map((card) => card.itemId))

    return [...returned.value, ...open.filter((card) => !later.has(card.itemId)), ...skippedLast]
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

  /** For the counter under the title: what the server counts, less what is on its way. */
  const count = computed(() => {
    const answer = remembered.value?.answer
    if (!answer) return 0
    const listed = new Set(answer.items.map((card) => card.itemId))
    const sending = drafts.waiting.filter((draft) => listed.has(draft.card.itemId)).length
    const back = returned.value.filter((card) => !listed.has(card.itemId)).length
    return Math.max(0, answer.total - sending) + back
  })

  const phase = computed<QueuePhase>(() => {
    if (!remembered.value) {
      if (failure.value) return failure.value
      return 'loading'
    }
    return cards.value.length > 0 ? 'ready' : 'empty'
  })

  /** Shown from memory because a fresh answer could not be had. */
  const stale = computed(() => failure.value !== null && remembered.value !== null)
  const fetchedAt = computed(() => remembered.value?.fetchedAt ?? null)

  async function load(): Promise<void> {
    if (loading.value || !actor.id) return
    const owner = actor.id
    loading.value = true
    try {
      const answer = await api.pendingVerdicts()
      if (actor.id !== owner) return
      remembered.value = { answer, fetchedAt: new Date() }
      failure.value = null
      rememberAnswer()
    } catch {
      if (actor.id !== owner) return
      // Decided after the failure: a connection lost while the answer was on its way is not
      // the server's fault, and is never drawn red.
      failure.value = navigator.onLine ? 'error' : 'offline'
    } finally {
      loading.value = false
    }
  }

  /** «Сохранить оценку»: the draft is kept and the next card is there at once. */
  function save(card: PendingVerdict, score: Score, review: string): void {
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

  return { phase, cards, current, count, stale, fetchedAt, save, skip, retry: load }
}
