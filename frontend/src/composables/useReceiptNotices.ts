import type { Ref } from 'vue'
import { api } from '@/api'
import { useTapSetting } from '@/composables/useTapSetting'
import type { TapSettingState } from '@/composables/useTapSetting'

export interface ReceiptNoticesState extends Omit<TapSettingState<boolean>, 'value'> {
  /** Whether the person turned «чек разобран» off; undefined while it is not known yet. */
  readonly off: Ref<boolean | undefined>
}

/**
 * «Сообщать, что чек разобран» on the page «Бот» (MOL-129, В-2): saved on the tap, its own address,
 * as the rating reminders' is (MOL-103 Р-1).
 */
export function useReceiptNotices(): ReceiptNoticesState {
  const { value, ...setting } = useTapSetting<boolean>(
    async () => (await api.receiptNoticesSetting()).off,
    async (off) => (await api.chooseReceiptNotices(!off)).off,
  )
  return { off: value, ...setting }
}
