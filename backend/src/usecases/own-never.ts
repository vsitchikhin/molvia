import { OWN_NEVER_MAX, verdictLevel } from '@molvia/model'
import type { OwnNeverResponse } from '@molvia/model'
import type { VerdictRepository } from '@/db/verdicts-repository'

/** How many of one's own verdicts are looked through, newest first. Far above anyone's ratings. */
const OWN_VERDICTS_READ = 5000

/**
 * The items this person rated «не брать нигде» themselves (MOL-92, adversarial Б′): what the phone
 * lets go of in «Тут дешевле» remembered for no signal. One's own verdict, never an average — with
 * access «Что брать» lists the average of three, and the hint reads one's own (adversarial Д). The
 * level is the domain's, one score as the hint reads it; withdrawn verdicts are none.
 */
export async function ownNever(
  verdicts: VerdictRepository,
  actorId: string,
): Promise<OwnNeverResponse> {
  const mine = await verdicts.listFor(actorId, OWN_VERDICTS_READ)
  const bad = mine.filter((verdict) => verdictLevel(verdict.score, 1) === 'never')
  return { itemIds: [...new Set(bad.map((verdict) => verdict.itemId))].slice(0, OWN_NEVER_MAX) }
}
