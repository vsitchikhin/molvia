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
 * Whose evening is already settled, and on which of their days: an owner's id and the day a claim
 * found nothing to send (adversarial Е). Kept by the API's one process between the bot's minutes —
 * a claim that finds nothing writes nothing, so without it the same empty claim was opened every
 * minute of the evening: a purchase only with a name the bot cannot be handed, or one the filter
 * could not rule out. One entry a person, overwritten the next day; a restart forgets it, and the
 * cost is one more empty claim each.
 */
export type QuietToday = Map<string, string>

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
  quiet: QuietToday,
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
    if (quiet.get(candidate.actorId) === clock.day) continue
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
    if (claimed === null) {
      // Nothing to send today, or somebody else sent it: either way the evening is done for them.
      quiet.set(candidate.actorId, clock.day)
      continue
    }
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
