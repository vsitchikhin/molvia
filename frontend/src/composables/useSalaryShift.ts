import type { Ref } from 'vue'
import { api } from '@/api'
import { useTapSetting } from '@/composables/useTapSetting'
import type { TapSettingState } from '@/composables/useTapSetting'

/** The day turning the setting on puts in: the one of the owner's sheet (MOL-134, В-5). */
export const SALARY_SHIFT_DEFAULT = 25

export interface SalaryShiftState extends Omit<TapSettingState<number | null>, 'value'> {
  /** The server's answer: a day, null for off, undefined while it is not known yet. */
  readonly day: Ref<number | null | undefined>
}

/**
 * «Зарплата с … числа — в следующий месяц» on the settings screen (MOL-134, В-3): saved on the tap,
 * as «мой курс / ЦБ РА» is (В-5), never part of the form under «Сохранить» — its four fields are also
 * a trip's context (Н-1).
 */
export function useSalaryShift(): SalaryShiftState {
  const { value, ...setting } = useTapSetting<number | null>(
    'salary-shift',
    async () => (await api.salaryShift()).day,
    async (day) => (await api.chooseSalaryShift(day)).day,
  )
  return { day: value, ...setting }
}
