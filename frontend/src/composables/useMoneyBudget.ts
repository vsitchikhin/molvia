import type { ComputedRef, Ref } from 'vue'
import { moneyBudgetCodec } from '@molvia/model'
import type { BudgetPlanBody, MoneyBudgetView } from '@molvia/model'
import { api } from '@/api'
import { useKeptAnswer } from '@/composables/useKeptAnswer'
import type { KeptPhase } from '@/composables/useKeptAnswer'
import { useActorStore } from '@/stores/actor'

export interface MoneyBudgetState {
  readonly phase: ComputedRef<KeptPhase>
  readonly budget: ComputedRef<MoneyBudgetView | null>
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  readonly attempt: ComputedRef<number>
  readonly retry: () => Promise<void>
  /** A plan from its month on (В-1): the month's budget it came back with is shown (review 6). */
  readonly save: (body: BudgetPlanBody) => Promise<MoneyBudgetView>
}

// The write of a plan before, answered or not. A plan is the last write the server got, with no
// revision, so the writes go in the order of the taps (adversarial Г1 of MOL-192) — kept here, not in
// the screen: a step back and in again mounts a new screen while the write of the old one is on its
// way, and the new one's went first (Г2). It outlives the screen, so it outlives the person too: a write
// goes only while the server still says it is the one who tapped (MOL-56), or it would land in the
// account of whoever came in through the door meanwhile (adversarial Д1). One for the whole module, the
// tests' too: a write a test leaves on its way holds every write after it.
let previous: Promise<unknown> = Promise.resolve()

function inTurn(
  body: BudgetPlanBody,
  actor: ReturnType<typeof useActorStore>,
  owner: string | null,
): Promise<MoneyBudgetView> {
  const written = previous.then(() => {
    if (actor.state !== 'ready' || owner === null || actor.id !== owner)
      throw new Error('the plan was tapped by someone the server no longer names')
    return api.setBudgetPlan(body)
  })
  previous = written.catch(() => undefined)
  return written
}

/**
 * «Бюджет» (MOL-117) of a month, counted by the server: the last three months read are kept per
 * owner, as «Графики» keep theirs, so offline is a strip over the month last seen. Read again when a
 * spending or a trip lands; a plan written shows the answer of its write.
 */
export function useMoneyBudget(month: Ref<string>): MoneyBudgetState {
  const actor = useActorStore()
  const kept = useKeptAnswer({
    key: 'molvia.budget',
    subject: month,
    ask: (asked) => api.moneyBudget(asked),
    codec: moneyBudgetCodec,
    kept: 3,
  })
  return {
    ...kept,
    budget: kept.answer,
    save: (body) => {
      const owner = actor.id
      return kept.write(body.from, () => inTurn(body, actor, owner))
    },
  }
}
