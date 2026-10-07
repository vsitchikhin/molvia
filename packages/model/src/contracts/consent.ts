import { z } from 'zod'

/**
 * The edition of «Условия использования» and «Данные и приватность» a person accepts (MOL-95) — one
 * number for both pages. **Raised by hand, and only for a change that matters** (owner's decision
 * В-1): a new kind of data, a new recipient, a new purpose, a change of the terms. Any other edit
 * of the text moves the pages' revision instead, and the test beside `PrivacyView` will not let the
 * text change without one (`frontend/src/views/policy.ts`), so nothing changes in silence — but a
 * line added to the privacy page by every task about data does not put everybody through the screen
 * again: nine revisions in the nine days before this task.
 *
 * Here rather than beside the page because the server needs it too: it refuses an edition that does
 * not exist yet. Which edition to ask about is the phone's (Р-3): the person accepts the text they
 * are shown, and that is the text of their build.
 */
export const POLICY_VERSION = 2

/**
 * The first edition whose text asks consent to the statistics (MOL-236): Armenia's law knows no
 * legitimate interest (art. 8), so the visit log is written, and the gates count a person, only once
 * they accepted it — and while «Учитывать меня в статистике» is on. Who accepted an older edition (a
 * build not yet updated) or none is neither written nor counted.
 */
export const STATISTICS_CONSENT_EDITION = 2

/**
 * `GET` and the answer of `PUT /actors/me/consent` (MOL-95): the edition this person accepted, or
 * none. Its own address and never a field of `/actors/me` (Р-5): an installed app reads that answer
 * strictly, and a field it did not know would fail every older build. No upper bound: a server newer
 * than the phone may know an edition the phone does not.
 */
export const consentSchema = z.strictObject({
  version: z.int().min(1).nullable(),
})
export type Consent = z.infer<typeof consentSchema>

/** The body of `PUT /actors/me/consent`: the edition the screen showed, one that exists. */
export const acceptConsentSchema = z.strictObject({
  version: z.int().min(1).max(POLICY_VERSION),
})
export type AcceptConsent = z.infer<typeof acceptConsentSchema>

/**
 * Whether the person must pass the consent screen before the app: they accepted no edition, or one
 * older than the one this build shows. An edition newer than the build's is no question — a phone
 * that has not updated yet does not ask about a text it cannot show.
 */
export function consentNeeded(accepted: number | null, current: number = POLICY_VERSION): boolean {
  return accepted === null || accepted < current
}
