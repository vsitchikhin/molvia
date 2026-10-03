import { FEEDBACK_KINDS, feedbackAttachedSchema } from '@molvia/model'
import type { FeedbackAttached, FeedbackKind } from '@molvia/model'
import { forget, read, write } from '@/stores/storage'

/**
 * What is typed in «Написать разработчику» (MOL-147), kept on the device under the person from the
 * first letter until it is sent: closing the sheet, losing the connection or a reload loses nothing,
 * since there is no queue to keep it instead (MOL-150, В-2). «Выйти» takes it with everything else of
 * the person's, and does not count it among what waits to be sent (Р-15) — it was never sent.
 *
 * The key is the content's, not the draft's (Р-2): a new one with every change of the kind or the
 * text, kept beside them so a retry after a lost answer — after a reload too — is the same message.
 */
export interface FeedbackDraft {
  /** `''` — not chosen yet: nothing chooses it for the person (MOL-146). */
  readonly kind: FeedbackKind | ''
  readonly text: string
  readonly clientKey: string
  /**
   * What went with the text the first time it was sent under this key — kept until the content
   * changes, since the server holds a repeat to all of the message, not to the words alone. Sent
   * again from another screen, with another code or after a new build, a key that may have reached
   * the server would meet `409` and a second message (adversarial В1, В2).
   */
  readonly attached?: FeedbackAttached
  /**
   * How many pictures went with the draft (MOL-167, Р-6). The pictures themselves live in the page's
   * memory — megabytes on this shelf would push out the queue of purchases kept on it — so after a
   * reload the sheet can only say they were not kept.
   */
  readonly pictures?: number
}

const keyOf = (owner: string): string => `molvia.feedback-draft.${owner}`

/** How many keys of messages sent are kept beside the draft: far more than windows of one phone. */
const SENT_KEPT = 8

function isKind(value: unknown): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly unknown[]).includes(value)
}

/** The shelf as it lies: a draft, the keys sent, or both. */
function stored(owner: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(read(keyOf(owner)) ?? 'null')
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function sentOf(value: Record<string, unknown>): string[] {
  return Array.isArray(value.sent)
    ? value.sent.filter((key): key is string => typeof key === 'string')
    : []
}

function store(owner: string, draft: FeedbackDraft | null, sent: readonly string[]): void {
  if (draft === null && sent.length === 0) forget(keyOf(owner))
  else write(keyOf(owner), JSON.stringify({ ...draft, ...(sent.length > 0 ? { sent } : {}) }))
}

export function recallFeedbackDraft(owner: string | null): FeedbackDraft | null {
  if (owner === null) return null
  const { kind, text, clientKey, attached, pictures } = stored(owner)
  if (typeof text !== 'string' || typeof clientKey !== 'string') return null
  const sent = feedbackAttachedSchema.safeParse(attached)
  return {
    kind: isKind(kind) ? kind : '',
    text,
    clientKey,
    ...(sent.success ? { attached: sent.data } : {}),
    ...(typeof pictures === 'number' && pictures > 0 ? { pictures } : {}),
  }
}

/** A draft with no kind, no text and no picture is no draft: it is forgotten rather than kept empty. */
export function keepFeedbackDraft(owner: string | null, draft: FeedbackDraft): void {
  if (owner === null) return
  const empty = draft.kind === '' && draft.text === '' && (draft.pictures ?? 0) === 0
  store(owner, empty ? null : draft, sentOf(stored(owner)))
}

/**
 * Notes `clientKey` among the messages sent and lets go of the draft if it is still the one sent —
 * not one changed after it left. A sheet still open in another window of the app holds that text
 * under that key, and sent from there with what its own opening attaches it met `409` and a second
 * message (round 6, У1); an empty shelf could not tell it the draft had left, since text erased or a
 * shelf that never kept it look the same. The keys are kept beside the draft, not in its place: a new
 * draft begun in the window that sent must not wipe what the other window asks about (review 6).
 */
export function dropFeedbackDraft(owner: string | null, clientKey: string): void {
  if (owner === null) return
  const draft = recallFeedbackDraft(owner)
  const sent = [...sentOf(stored(owner)).filter((key) => key !== clientKey), clientKey]
  store(owner, draft?.clientKey === clientKey ? null : draft, sent.slice(-SENT_KEPT))
}

/** Whether a message went under `clientKey` from this device and reached the owner. */
export function feedbackSent(owner: string | null, clientKey: string): boolean {
  return owner !== null && sentOf(stored(owner)).includes(clientKey)
}
