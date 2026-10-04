import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import type { ReceiptNoticesSetting } from '@molvia/model'
import { api } from '@/api'
import { useTapSetting } from '@/composables/useTapSetting'
import type { TapSettingState } from '@/composables/useTapSetting'

export interface ReceiptNoticesState extends Omit<
  TapSettingState<ReceiptNoticesSetting>,
  'value' | 'choose'
> {
  /** Whether the person turned «чек разобран» off; undefined while it is not known yet. */
  readonly off: ComputedRef<boolean | undefined>
  /** Whether the bot is blocked in Telegram — nothing comes then (review №1). */
  readonly blocked: ComputedRef<boolean>
  choose(off: boolean): Promise<void>
}

/**
 * «Сообщать, что чек разобран» on the page «Бот» (MOL-129, В-2): saved on the tap, its own address,
 * as the rating reminders' is (MOL-103 Р-1). Its answer also says whether the bot is blocked: the
 * reminders' cannot, over «chosen».
 */
export function useReceiptNotices(): ReceiptNoticesState {
  const tap = useTapSetting<ReceiptNoticesSetting>(
    async () => api.receiptNoticesSetting(),
    async (next) => api.chooseReceiptNotices(!next.off),
  )
  const { value, ...setting } = tap
  return {
    ...setting,
    off: computed(() => value.value?.off),
    blocked: computed(() => value.value?.blocked ?? false),
    choose: async (off) => {
      if (value.value) await tap.choose({ ...value.value, off })
    },
  }
}
