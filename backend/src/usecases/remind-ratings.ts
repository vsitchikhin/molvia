import {
  COUNTRY_TIME_ZONES,
  REMINDERS_PER_CLAIM,
  REMINDER_ITEMS,
  daysBetween,
  isReminderHour,
  localClock,
  planReminder,
  reminderItemSchema,
  timeZoneOf,
} from '@molvia/model'
import type { DueReminders, PendingVerdict } from '@molvia/model'
import type { ReminderRepository } from '@/db/reminders-repository'

/** What of an item the bot is handed, checked by the contract it reads (adversarial А). */
const sendableFields = reminderItemSchema.pick({ name: true, placeName: true })

function sendable(item: PendingVerdict): boolean {
  return sendableFields.safeParse({ name: item.name, placeName: item.placeName }).success
}

/**
 * «Напомнить об оценке» (MOL-101): the reminders due now, handed to the bot and marked as sent.
 *
 * The bot asks every minute and keeps nothing; who is reminded, when and about what is decided
 * here and in the domain — the person's evening in their own zone, the step of the ladder
 * (`planReminder`), the purchases the step asks about. The bot only sends what it gets.
 *
 * A person in a country we have no zone for is not reminded: there is no evening to pick.
 *
 * **A person is claimed alone, and fails alone** (adversarial А). Each claim commits by itself, so
 * one that throws — a dropped connection, a statement timeout — is handed to `failed` and the
 * others of the minute go on: before, it threw the whole answer away with everybody already
 * marked, and «at most once» became «never, for all of them».
 */
export async function remindRatings(
  reminders: ReminderRepository,
  now: Date,
  failed: (error: unknown) => void,
): Promise<DueReminders> {
  // Outside every evening there is nothing to ask the database (review Т-5): 21 hours of 24.
  const open = Object.values(COUNTRY_TIME_ZONES).some((zone) =>
    isReminderHour(localClock(now, zone).hour),
  )
  if (!open) return { reminders: [] }

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
    // Only step 1 is skipped this way: a later step with nothing to ask about has to reach the
    // claim, which ends the ladder (Л-2).
    if (
      plan.step === 1 &&
      (candidate.lastUnratedAt === null ||
        localClock(candidate.lastUnratedAt, timeZone).day < plan.from)
    ) {
      continue
    }

    let claimed
    try {
      claimed = await reminders.claim(
        {
          actorId: candidate.actorId,
          timeZone,
          plan,
          today: clock.day,
          previous: candidate.ladder?.remindedOn ?? null,
          now,
        },
        REMINDER_ITEMS,
        sendable,
      )
    } catch (error) {
      failed(error)
      continue
    }
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
