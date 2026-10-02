import type { ComputedRef, Ref } from 'vue'
import { moneyChartMonthCodec, moneyChartYearCodec } from '@molvia/model'
import type { MoneyChartMonthView, MoneyChartYearView } from '@molvia/model'
import { api } from '@/api'
import { useKeptAnswer } from '@/composables/useKeptAnswer'
import type { KeptPhase } from '@/composables/useKeptAnswer'

export type ChartsPhase = KeptPhase

export interface MoneyChartMonthState {
  readonly phase: ComputedRef<ChartsPhase>
  readonly charts: ComputedRef<MoneyChartMonthView | null>
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  readonly retry: () => Promise<void>
}

/**
 * «Графики → Месяц» (MOL-158): the last three months read are kept per owner, as «Деньги» keep
 * theirs (Р-8), so offline is a strip over the month last seen rather than an empty screen.
 */
export function useMoneyChartMonth(month: Ref<string>): MoneyChartMonthState {
  const kept = useKeptAnswer({
    key: 'molvia.chartmonths',
    subject: month,
    ask: (asked) => api.moneyChartMonth(asked),
    codec: moneyChartMonthCodec,
    kept: 3,
  })
  return { ...kept, charts: kept.answer }
}

export interface MoneyChartYearState {
  readonly phase: ComputedRef<ChartsPhase>
  readonly charts: ComputedRef<MoneyChartYearView | null>
  readonly stale: ComputedRef<'loading' | 'offline' | 'error' | null>
  readonly fetchedAt: ComputedRef<Date | null>
  readonly retry: () => Promise<void>
}

/**
 * «Графики → Год» (MOL-160): the last three years read are kept per owner, as the months are (Р-10),
 * so offline is a strip over the year last seen rather than an empty screen.
 */
export function useMoneyChartYear(year: Ref<string>): MoneyChartYearState {
  const kept = useKeptAnswer({
    key: 'molvia.chartyears',
    subject: year,
    ask: (asked) => api.moneyChartYear(asked),
    codec: moneyChartYearCodec,
    kept: 3,
  })
  return { ...kept, charts: kept.answer }
}
