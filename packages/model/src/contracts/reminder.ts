import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { telegramUserIdSchema } from '#model/entities/actor'
import { itemSchema } from '#model/entities/item'
import { placeSchema } from '#model/entities/place'
import { REMINDERS_OFF, REMINDER_ITEMS, REMINDER_SWITCHES } from '#model/entities/reminder'
import { newVerdictSchema } from '#model/entities/verdict'

/**
 * One item a reminder asks about (MOL-101): the name and the place of its latest purchase, as the
 * card of «Оценки» has them — the person has to remember what it was — and how many of their days
 * ago that was, so the bot can say «вчера» without knowing their zone. The place's city goes as on
 * the card (MOL-120): printed where two items of one reminder name one shop of two cities, and
 * optional, so a bot of the new version reads the API of the old one.
 */
export const reminderItemSchema = z.strictObject({
  itemId: z.uuid(),
  name: itemSchema.shape.name,
  placeName: placeSchema.shape.name,
  placeCity: placeSchema.shape.city.optional(),
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

/**
 * `GET` and the answer of `PUT /actors/me/reminders` (MOL-103): whether the bot reminds, and if not,
 * why — `blocked` is what the screen explains. Its own address beside the settings and never a field
 * of their form or of `/actors/me` (Р-1): those four fields are also a trip's context, and an
 * installed app reads `/actors/me` strictly.
 */
export const remindersSettingSchema = z.strictObject({
  off: z.enum(REMINDERS_OFF).nullable(),
})
export type RemindersSetting = z.infer<typeof remindersSettingSchema>

/** The body of `PUT /actors/me/reminders`, saved on the tap. */
export const chooseRemindersSchema = z.strictObject({ on: z.boolean() })
export type ChooseReminders = z.infer<typeof chooseRemindersSchema>

/**
 * The body of `POST /internal/reminders/switch` (MOL-103): «Не напоминать» or «Вернуть напоминания»
 * pressed under a reminder, or Telegram saying the bot was blocked or unblocked. Whose reminders they
 * are is `ctx.from.id` — or the chat a message failed to reach, which in a private chat is the same
 * person — and never anything in a button.
 */
export const switchRemindersFromBotSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  change: z.enum(REMINDER_SWITCHES),
})
export type SwitchRemindersFromBot = z.infer<typeof switchRemindersFromBotSchema>
