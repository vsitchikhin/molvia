import type { ComputedRef, Ref } from 'vue'
import { moneyBudgetCodec } from '@molvia/model'
import type { MoneyBudgetView } from '@molvia/model'
import { api } from '@/api'
import { useKeptAnswer } from '@/composables/useKeptAnswer'
import type { KeptPhase } from '@/composables/useKeptAnswer'

export interface MoneyBudgetState {
  readonly phase: ComputedRef<KeptPhase>
  readonly budget: ComputedRef<MoneyBudgetView | null>
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  readonly retry: () => Promise<void>
  /** The budget a plan's write came back with: shown, with no second read (review 6). */
  readonly accept: (month: string, budget: MoneyBudgetView) => void
}

/**
 * «Бюджет» (MOL-117) of a month, counted by the server: the last three months read are kept per
 * owner, as «Графики» keep theirs, so offline is a strip over the month last seen. Read again when a
 * spending or a trip lands; a plan written shows the answer of its write.
 */
export function useMoneyBudget(month: Ref<string>): MoneyBudgetState {
  const kept = useKeptAnswer({
    key: 'molvia.budget',
    subject: month,
    ask: (asked) => api.moneyBudget(asked),
    codec: moneyBudgetCodec,
    kept: 3,
  })
  return { ...kept, budget: kept.answer }
}
