import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { telegramUserIdSchema } from '#model/entities/actor'
import { itemSchema } from '#model/entities/item'
import { placeSchema } from '#model/entities/place'
import { REMINDER_ITEMS } from '#model/entities/reminder'
import { newVerdictSchema } from '#model/entities/verdict'

/**
 * One item a reminder asks about (MOL-101): the name and the place of its latest purchase, as the
 * card of «Оценки» has them — the person has to remember what it was — and how many of their days
 * ago that was, so the bot can say «вчера» without knowing their zone.
 */
export const reminderItemSchema = z.strictObject({
  itemId: z.uuid(),
  name: itemSchema.shape.name,
  placeName: placeSchema.shape.name,
  daysAgo: z.int().positive(),
})
export type ReminderItem = z.infer<typeof reminderItemSchema>

/**
 * A reminder the API has handed to the bot to send, and marked as sent (Р-2). The chat is the
 * person's Telegram id — a private chat with the bot has the user's id — and nothing else of theirs
 * travels: no actor id, no language, no step.
 */
export const reminderSchema = z
  .strictObject({
    telegramUserId: telegramUserIdSchema,
    items: z.array(reminderItemSchema).min(1).max(REMINDER_ITEMS),
    /** How many items wait in «Оценки» from the days asked about, the ones shown included. */
    total: z.int().positive(),
  })
  .refine((reminder) => reminder.total >= reminder.items.length, {
    error: ISSUE.RESPONSE_INVALID,
  })
export type Reminder = z.infer<typeof reminderSchema>

/** How many people one claim hands over; the rest wait for the next minute. */
export const REMINDERS_PER_CLAIM = 50

/** `POST /internal/reminders/claim`. */
export const dueRemindersSchema = z.strictObject({
  reminders: z.array(reminderSchema).max(REMINDERS_PER_CLAIM),
})
export type DueReminders = z.infer<typeof dueRemindersSchema>

/**
 * The body of `PUT /internal/verdicts/:itemId`: a press of 1–5 under a reminder. Whose verdict it
 * is comes from `ctx.from.id`, never from the button, and only a score travels — the review stays
 * as it is, exactly as a `PUT` from the screen without one leaves it (MOL-27).
 */
export const rateFromBotSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  score: newVerdictSchema.shape.score,
})
export type RateFromBot = z.infer<typeof rateFromBotSchema>
