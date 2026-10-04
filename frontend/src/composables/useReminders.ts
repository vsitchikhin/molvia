import type { Ref } from 'vue'
import type { RemindersOff } from '@molvia/model'
import { api } from '@/api'
import { useTapSetting } from '@/composables/useTapSetting'
import type { TapSettingState } from '@/composables/useTapSetting'

export interface RemindersState extends Omit<TapSettingState<RemindersOff | null>, 'value'> {
  /** Why the reminders are off, null — on, undefined while it is not known yet. */
  readonly off: Ref<RemindersOff | null | undefined>
}

/**
 * «Напоминать об оценке» on the page «Бот» (MOL-103, MOL-129): saved on the tap, beside the
 * form and never in it (Р-1). Turned off it is `chosen`; turned on it starts over, whatever turned
 * it off — a blocked bot included.
 */
export function useReminders(): RemindersState {
  const { value, ...setting } = useTapSetting<RemindersOff | null>(
    async () => (await api.remindersSetting()).off,
    async (off) => (await api.chooseReminders(off === null)).off,
  )
  return { off: value, ...setting }
}
