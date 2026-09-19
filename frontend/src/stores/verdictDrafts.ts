import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { ApiError } from '@molvia/client'
import { ERROR, ISSUE, isWireCode, pendingVerdictCodec, ratingSchema } from '@molvia/model'
import type { PendingVerdict, Rating, WireCode } from '@molvia/model'
import { api } from '@/api'
import { useActorStore } from '@/stores/actor'
import { read, write } from '@/stores/storage'

export type Score = Rating['score']

/**
 * A verdict on the phone before the server has it. `typing` is what the card holds while the
 * person is still choosing — kept so a PWA unloaded mid-sentence gives the text back (MOL-28,
 * В-5) — and is never sent. `saved` waits to be sent. `error` is the code of a refusal that a
 * repeat would only meet again: the draft is back to `typing` for the person to fix.
 */
export interface VerdictDraft {
  readonly card: PendingVerdict
  readonly score: Score | null
  readonly review: string
  readonly state: 'typing' | 'saved'
  readonly error: WireCode | null
}

/** Why the last run stopped with drafts left: the connection, or a server that broke. */
export type Held = 'offline' | 'failed'

const KEY = 'molvia.verdict-drafts'
const CONFIRMED_KEY = 'molvia.verdict-confirmed'

/**
 * What stops a run rather than refusing the draft: no connection or a server that broke (both
 * arrive as INTERNAL), an answer off the contract — the captive portal of a shop's wifi — and
 * an identity the server no longer knows. The same three hold the trip queue (MOL-24).
 */
const HOLDS: readonly WireCode[] = [ERROR.INTERNAL, ISSUE.RESPONSE_INVALID, ERROR.NO_ACTOR]

type Loose = Record<string, unknown>

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null
}

function encode(draft: VerdictDraft): Loose {
  return { ...draft, card: pendingVerdictCodec.encode(draft.card) }
}

function decode(raw: unknown): VerdictDraft | null {
  if (!isRecord(raw)) return null
  const card = pendingVerdictCodec.safeParse(raw.card)
  const score = raw.score === null ? null : ratingSchema.shape.score.safeParse(raw.score).data
  const { review, state, error } = raw
  if (!card.success || score === undefined || typeof review !== 'string') return null
  if (state !== 'typing' && state !== 'saved') return null
  if (error !== null && !isWireCode(error)) return null
  // A saved draft without a score could never be sent, and would hide its card for good.
  if (state === 'saved' && score === null) return null
  return { card: card.data, score, review, state, error }
}

/** A broken entry is dropped alone: the ones beside it are somebody's words. */
function recall(key: string): Record<string, VerdictDraft> {
  const raw = read(key)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return {}
    const drafts: Record<string, VerdictDraft> = {}
    for (const draft of parsed.map(decode)) if (draft) drafts[draft.card.itemId] = draft
    return drafts
  } catch {
    return {}
  }
}

/** Item → when the server confirmed its rating, as epoch milliseconds. */
function recallConfirmed(key: string): Record<string, number> {
  const raw = read(key)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
      ),
    )
  } catch {
    return {}
  }
}

/** The review goes only when it says something: a `PUT` without one keeps what was written. */
function ratingOf(draft: VerdictDraft & { score: Score }): Rating {
  return draft.review.trim() ? { score: draft.score, review: draft.review } : { score: draft.score }
}

/**
 * Verdicts the person saved and the server has not confirmed (MOL-28, Р-3, Р-5). «Сохранить»
 * writes here and the card goes at once; sending is the app's business, not the screen's — at
 * start, on `online` and when the app comes back into view (`App.vue`).
 *
 * Not the trip queue: that is an ordered log of writes, each with an id of its own. A verdict is
 * addressed by its item and `PUT` is safe to repeat, so this is a map — the latest word on an
 * item replaces the earlier one, and the order of sending does not matter.
 */
export const useVerdictDraftsStore = defineStore('verdictDrafts', () => {
  const actor = useActorStore()

  const drafts = ref<Record<string, VerdictDraft>>({})
  const held = ref<Held | null>(null)
  /**
   * When each rating reached the server. Kept here, by whoever sends, and on the device: the
   * queue of «Оценки» may have been closed when a rating went, and a list it remembers from
   * before must not offer that item again when it opens (adversarial F1, R1).
   */
  const confirmed = ref<Record<string, number>>({})

  const waiting = computed(() =>
    Object.values(drafts.value).filter((draft) => draft.state === 'saved'),
  )

  function load(id: string | null): void {
    drafts.value = id ? recall(`${KEY}.${id}`) : {}
    confirmed.value = id ? recallConfirmed(`${CONFIRMED_KEY}.${id}`) : {}
    held.value = null
  }

  function persist(id: string | null): void {
    if (!id) return
    write(`${KEY}.${id}`, JSON.stringify(Object.values(drafts.value).map(encode)))
  }

  function put(draft: VerdictDraft): void {
    drafts.value = { ...drafts.value, [draft.card.itemId]: draft }
    persist(actor.id)
  }

  function confirm(itemId: string): void {
    confirmed.value = { ...confirmed.value, [itemId]: Date.now() }
    if (actor.id) write(`${CONFIRMED_KEY}.${actor.id}`, JSON.stringify(confirmed.value))
  }

  /** Forgets confirmations an answer asked for at `since` already reflects. */
  function settle(since: Date): void {
    const kept = Object.fromEntries(
      Object.entries(confirmed.value).filter(([, at]) => at >= since.getTime()),
    )
    if (Object.keys(kept).length === Object.keys(confirmed.value).length) return
    confirmed.value = kept
    if (actor.id) write(`${CONFIRMED_KEY}.${actor.id}`, JSON.stringify(kept))
  }

  function forget(itemId: string): void {
    if (!(itemId in drafts.value)) return
    const rest = { ...drafts.value }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is the item, a map
    delete rest[itemId]
    drafts.value = rest
    persist(actor.id)
  }

  load(actor.id)
  watch(
    () => actor.id,
    (id) => {
      load(id)
      void flush()
    },
  )

  /** What the card holds while the person is still choosing. Nothing chosen — nothing kept. */
  function keep(card: PendingVerdict, score: Score | null, review: string): void {
    if (drafts.value[card.itemId]?.state === 'saved') return
    if (score === null && !review.trim()) {
      forget(card.itemId)
      return
    }
    put({ card, score, review, state: 'typing', error: null })
  }

  /** «Сохранить оценку»: kept first, sent after — the card never waits for the network. */
  function save(card: PendingVerdict, score: Score, review: string): void {
    put({ card, score, review, state: 'saved', error: null })
    void flush()
  }

  let running: Promise<void> | null = null

  /**
   * One run at a time: two would send the same draft twice. A run cut short by a change of
   * identity is followed by one for the new identity.
   */
  function flush(): Promise<void> {
    if (!running) {
      const owner = actor.id
      running = drain(owner).finally(() => {
        running = null
        if (actor.id !== owner) void flush()
      })
    }
    return running
  }

  async function drain(owner: string | null): Promise<void> {
    if (!owner) return

    for (const draft of waiting.value) {
      if (draft.score === null) continue
      let refusal: WireCode | null = null
      try {
        await api.rateItem(draft.card.itemId, ratingOf({ ...draft, score: draft.score }))
      } catch (error) {
        const code = error instanceof ApiError ? error.code : ERROR.INTERNAL
        if (HOLDS.includes(code)) {
          // Decided after the failure, never before: a connection that drops while the answer
          // is on its way is the commonest break, and it is not the server's fault.
          // An identity the server forgot is not the connection: the draft waits, and the screen
          // says it did not go rather than «sending» for the rest of the session (adversarial H2).
          held.value = navigator.onLine || code === ERROR.NO_ACTOR ? 'failed' : 'offline'
          return
        }
        refusal = code
      }

      // The identity changed while the draft was out: the map in memory is now another
      // person's, and this draft is not among them.
      if (actor.id !== owner) return

      // Replaced while it was out: the newer word is still waiting and goes on the next pass.
      if (drafts.value[draft.card.itemId] !== draft) continue

      if (refusal && refusal !== ERROR.NOT_FOUND) {
        put({ ...draft, state: 'typing', error: refusal })
      } else {
        // Rated, or the item is gone: either way nothing is left to ask about it.
        confirm(draft.card.itemId)
        forget(draft.card.itemId)
      }
    }
    held.value = null
    if (waiting.value.length > 0) await drain(owner)
  }

  return { drafts, waiting, held, confirmed, keep, save, forget, settle, flush }
})
