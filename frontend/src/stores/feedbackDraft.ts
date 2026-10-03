import { FEEDBACK_KINDS } from '@molvia/model'
import type { FeedbackKind } from '@molvia/model'
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
}

const keyOf = (owner: string): string => `molvia.feedback-draft.${owner}`

function isKind(value: unknown): value is FeedbackKind {
  return (FEEDBACK_KINDS as readonly unknown[]).includes(value)
}

export function recallFeedbackDraft(owner: string | null): FeedbackDraft | null {
  if (owner === null) return null
  try {
    const value: unknown = JSON.parse(read(keyOf(owner)) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const { kind, text, clientKey } = value as Record<string, unknown>
    if (typeof text !== 'string' || typeof clientKey !== 'string') return null
    return { kind: isKind(kind) ? kind : '', text, clientKey }
  } catch {
    return null
  }
}

/** A draft with neither a kind nor a text is no draft: it is forgotten rather than kept empty. */
export function keepFeedbackDraft(owner: string | null, draft: FeedbackDraft): void {
  if (owner === null) return
  if (draft.kind === '' && draft.text === '') forget(keyOf(owner))
  else write(keyOf(owner), JSON.stringify(draft))
}

/** Forgets the draft that was sent — the one under `clientKey`, not one changed after it left. */
export function dropFeedbackDraft(owner: string | null, clientKey: string): void {
  if (owner !== null && recallFeedbackDraft(owner)?.clientKey === clientKey) forget(keyOf(owner))
}
