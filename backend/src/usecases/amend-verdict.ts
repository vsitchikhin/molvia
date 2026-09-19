import { DomainError, ERROR } from '@molvia/model'
import type { Verdict, VerdictAmendment } from '@molvia/model'
import type { VerdictRepository } from '@/db/verdicts-repository'

/**
 * «Изменить оценку» (MOL-27): part of a verdict the person already gave — the score, the
 * text, or the text erased with `review: null`. Without it a review, once written, could
 * only ever be replaced: `PUT` reads «no review» as «keep it».
 *
 * Nothing to change answers «not found», and someone else's verdict answers the same.
 */
export async function amendVerdict(
  verdicts: VerdictRepository,
  actorId: string,
  itemId: string,
  patch: VerdictAmendment,
): Promise<Verdict> {
  const verdict = await verdicts.amend(actorId, itemId, patch)
  if (!verdict) throw new DomainError(ERROR.NOT_FOUND)
  return verdict
}
