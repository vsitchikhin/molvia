import { PENDING_VERDICTS_LIMIT } from '@molvia/model'
import type { PendingVerdicts } from '@molvia/model'
import type { ExpenseRepository } from '@/db/expenses-repository'

/**
 * «Оценки» (MOL-28): what the person bought and has not rated, one card per item. Until the
 * bot of 0.2 this screen is the only way a verdict is born, so it reads the person's own
 * purchases and nothing else — and writes nothing to the log: it is entering, not reading
 * someone else's data.
 *
 * With it, whether anything was bought at all (MOL-214): the screen's own question, which the
 * reminder asking the same queue does not need.
 */
export async function pendingVerdicts(
  expenses: ExpenseRepository,
  actorId: string,
): Promise<PendingVerdicts> {
  const pending = await expenses.pendingVerdictsFor(actorId, PENDING_VERDICTS_LIMIT)
  // Asked only of an empty queue, and after it: a card is a purchase, and a second statement that
  // missed one written meanwhile would send «nothing bought» beside it, which the phone refuses.
  const bought = pending.total > 0 || (await expenses.hasPurchases(actorId))
  return { ...pending, bought }
}
