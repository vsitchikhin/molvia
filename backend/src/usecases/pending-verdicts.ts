import { PENDING_VERDICTS_LIMIT } from '@molvia/model'
import type { PendingVerdicts } from '@molvia/model'
import type { ExpenseRepository } from '@/db/expenses-repository'

/**
 * «Оценки» (MOL-28): what the person bought and has not rated, one card per item. Until the
 * bot of 0.2 this screen is the only way a verdict is born, so it reads the person's own
 * purchases and nothing else — and writes nothing to the log: it is entering, not reading
 * someone else's data.
 */
export async function pendingVerdicts(
  expenses: ExpenseRepository,
  actorId: string,
): Promise<PendingVerdicts> {
  return expenses.pendingVerdictsFor(actorId, PENDING_VERDICTS_LIMIT)
}
