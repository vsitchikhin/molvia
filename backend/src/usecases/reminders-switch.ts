import { DomainError, ERROR } from '@molvia/model'
import type {
  Actor,
  ChooseReminders,
  RemindersSetting,
  SwitchRemindersFromBot,
} from '@molvia/model'
import type { ReminderRepository } from '@/db/reminders-repository'

/** `GET /actors/me/reminders` (MOL-103): whether the bot reminds, and why not if it does not. */
export async function remindersSettingOf(
  reminders: Pick<ReminderRepository, 'remindersOff'>,
  owner: Pick<Actor, 'id'>,
): Promise<RemindersSetting> {
  return { off: await reminders.remindersOff(owner.id) }
}

/**
 * `PUT /actors/me/reminders`, saved on the tap as «Зарплата — в следующий месяц» is (Р-1). Turned
 * on over a blocked bot it stays `blocked` (В-5): only an unblock lifts that, and the screen does not
 * offer it.
 */
export async function chooseReminders(
  reminders: Pick<ReminderRepository, 'switchReminders'>,
  owner: Pick<Actor, 'id'>,
  { on }: ChooseReminders,
  now: Date,
): Promise<RemindersSetting> {
  const off = await reminders.switchReminders(
    { actorId: owner.id },
    on ? 'on' : 'off',
    'settings',
    now,
  )
  return { off: off ?? null }
}

/**
 * The bot's word on the switch (MOL-103): «Не напоминать» or «Вернуть напоминания» pressed, or
 * Telegram saying the bot was blocked or unblocked. An account with no owner changes nothing, and
 * for «off», «blocked» and «unblocked» that is no error: «off» is true of it either way, as
 * erasure's «ваших данных нет» is (Р-6), and Telegram's word is nobody's to answer. **«On» for no
 * one is `404`** (adversarial В): «Напоминания снова включены» to an erased account was a statement
 * about its data, and false.
 */
export async function switchRemindersFromBot(
  reminders: Pick<ReminderRepository, 'switchReminders'>,
  { telegramUserId, change }: SwitchRemindersFromBot,
  now: Date,
): Promise<void> {
  const off = await reminders.switchReminders({ telegramUserId }, change, 'bot', now)
  if (off === undefined && change === 'on') throw new DomainError(ERROR.NOT_FOUND)
}
