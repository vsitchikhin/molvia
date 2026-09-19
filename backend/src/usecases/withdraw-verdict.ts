import { DomainError, ERROR } from '@molvia/model'
import type { VerdictRepository } from '@/db/verdicts-repository'

/**
 * «Снять оценку» (MOL-27, the owner's decision). The verdict disappears from everything the
 * person sees and from «Что брать»; the row stays for the 0.2 gate, which counts every rating
 * ever given, and the text is erased. Rating the item again brings the row back.
 *
 * Nothing to withdraw answers «not found» — none, already withdrawn, or someone else's, alike.
 * A repeat from an offline queue meets exactly that, and the client counts it as done.
 */
export async function withdrawVerdict(
  verdicts: VerdictRepository,
  actorId: string,
  itemId: string,
): Promise<void> {
  if (!(await verdicts.withdraw(actorId, itemId))) throw new DomainError(ERROR.NOT_FOUND)
}
