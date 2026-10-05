import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { AnalyticsSetting } from '@molvia/model'
import { api } from '@/api'
import { useTapSetting } from '@/composables/useTapSetting'
import type { TapSettingState } from '@/composables/useTapSetting'

export interface AnalyticsState extends Omit<
  TapSettingState<AnalyticsSetting>,
  'value' | 'choose'
> {
  /** Whether the person objected to being counted; undefined while it is not known yet. */
  readonly off: ComputedRef<boolean | undefined>
  choose(off: boolean): Promise<void>
}

/**
 * «Учитывать меня в статистике» in «Ваши данные» (MOL-96): saved on the tap at its own address, with
 * no sheet (В-3) — off erases the past marks, which the hint under the switch says.
 */
export function useAnalytics(): AnalyticsState {
  const tap = useTapSetting<AnalyticsSetting>(
    'analytics',
    async () => api.analyticsSetting(),
    async (next) => api.chooseAnalytics(!next.off),
  )
  const { value, ...setting } = tap
  return {
    ...setting,
    off: computed(() => value.value?.off),
    choose: async (off) => {
      if (value.value) await tap.choose({ ...value.value, off })
    },
  }
}
