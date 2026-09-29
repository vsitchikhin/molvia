import {
  REMINDERS_PER_CLAIM,
  REMINDER_ITEMS,
  daysBetween,
  isReminderHour,
  localClock,
  planReminder,
  timeZoneOf,
} from '@molvia/model'
import type { DueReminders } from '@molvia/model'
import type { ReminderRepository } from '@/db/reminders-repository'

/**
 * «Напомнить об оценке» (MOL-101): the reminders due now, handed to the bot and marked as sent.
 *
 * The bot asks every minute and keeps nothing; who is reminded, when and about what is decided
 * here and in the domain — the person's evening in their own zone, the step of the ladder
 * (`planReminder`), the purchases the step asks about. The bot only sends what it gets.
 *
 * A person in a country we have no zone for is not reminded: there is no evening to pick.
 */
export async function remindRatings(
  reminders: ReminderRepository,
  now: Date,
): Promise<DueReminders> {
  const due: DueReminders['reminders'][number][] = []
  for (const candidate of await reminders.candidates()) {
    if (due.length >= REMINDERS_PER_CLAIM) break
    const timeZone = timeZoneOf(candidate.country)
    if (timeZone === null) continue
    const clock = localClock(now, timeZone)
    if (!isReminderHour(clock.hour)) continue
    const plan = planReminder({
      ladder: candidate.ladder,
      ratedSince: candidate.ratedSince,
      today: clock.day,
    })
    if (plan === null) continue

    const claimed = await reminders.claim(
      {
        actorId: candidate.actorId,
        timeZone,
        plan,
        today: clock.day,
        previous: candidate.ladder?.remindedOn ?? null,
        now,
      },
      REMINDER_ITEMS,
    )
    if (claimed === null) continue
    due.push({
      telegramUserId: candidate.telegramUserId,
      items: claimed.items.map(({ itemId, name, placeName, boughtAt }) => ({
        itemId,
        name,
        placeName,
        daysAgo: daysBetween(localClock(boughtAt, timeZone).day, clock.day),
      })),
      total: claimed.total,
    })
  }
  return { reminders: due }
}
