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
const sendableFields = reminderItemSchema.pick({ name: true, placeName: true, placeCity: true })

function sendable(item: PendingVerdict): boolean {
  return sendableFields.safeParse({
    name: item.name,
    placeName: item.placeName,
    placeCity: item.placeCity,
  }).success
}

/**
 * Whose evening is already settled: an owner's id, the day a claim found nothing to send, and the
 * latest entry of an unrated purchase it saw then (adversarial Е). Kept by the API's one process
 * between the bot's minutes — a claim that finds nothing writes nothing, so without it the same
 * empty claim was opened every minute of the evening: a purchase only with a name the bot cannot
 * be handed, or one the filter could not rule out. **A purchase entered after it opens the evening
 * again** (adversarial И): «nothing at 19:00» is an answer about 19:00, and the milk remembered at
 * 20:00 and written into yesterday's trip is yesterday's too — tomorrow it would be too old to ask.
 * One entry a person, overwritten the next time; a restart forgets it, and the cost is one more
 * empty claim each.
 */
export type QuietToday = Map<string, { readonly day: string; readonly entered: number | null }>

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
  // Outside every evening there is nothing to ask the database (review Т-5): Yerevan's and Tbilisi's
  // evening and Belgrade's two or three hours later (MOL-109) leave 19 hours of 24 closed in summer,
  // 18 in winter.
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
    const entered = candidate.lastUnratedEnteredAt?.getTime() ?? null
    const settled = quiet.get(candidate.actorId)
    if (settled?.day === clock.day && settled.entered === entered) continue
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
      quiet.set(candidate.actorId, { day: clock.day, entered })
      continue
    }
    due.push({
      telegramUserId: candidate.telegramUserId,
      items: claimed.items.map(({ itemId, name, placeName, placeCity, boughtAt }) => ({
        itemId,
        name,
        placeName,
        placeCity,
        daysAgo: daysBetween(localClock(boughtAt, timeZone).day, clock.day),
      })),
      total: claimed.total,
    })
  }
  return { reminders: due }
}
