import { z } from 'zod'
import { telegramUserIdSchema } from '#model/entities/actor'
import { placeSchema } from '#model/entities/place'
import { LOCALES } from '#model/support/locale'

/**
 * «Чек разобран» (MOL-129) as the API hands it to the bot to send — and has marked as told: whose
 * chat, which receipt for the button, read or not, and the words of the message. No sum, no line, no
 * item and no tax number: the message lies on Telegram's servers. The language is the receipt's —
 * the interface's when it was sent (П-4), since the person's Telegram language is not kept.
 */
export const receiptNoticeSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  receiptId: z.uuid(),
  outcome: z.enum(['parsed', 'failed']),
  language: z.enum(LOCALES),
  /** The place the review shows, by the seller's tax number; `null` — not found. */
  place: placeSchema.shape.name.nullable(),
  /** The receipt's day: printed on it, else the day of the shot in the person's zone. */
  day: z.iso.date(),
  lineCount: z.int().min(0),
  /**
   * The same receipt — tax number and number — is recorded already (Т-11, adversarial А4): the
   * review says «уже записан», so the message must not say «запишите».
   */
  duplicate: z.boolean(),
  /**
   * A Serbian receipt by its link that failed (MOL-232, adversarial Р2-1): what to tell of it, since it
   * has no photo to read or retake — the tax office never showed it (`missing`), does not accept it
   * (`invalid`), or it could not be read at all (`unread`). `null` for everything else.
   */
  taxOffice: z.enum(['missing', 'invalid', 'unread']).nullable(),
  /** Night in the person's zone: the message comes without a sound. */
  silent: z.boolean(),
})
export type ReceiptNotice = z.infer<typeof receiptNoticeSchema>

/** How many receipts one claim hands over; the rest wait for the next minute. */
export const RECEIPT_NOTICES_PER_CLAIM = 50

/** `POST /internal/receipts/claim`. */
export const dueReceiptNoticesSchema = z.strictObject({
  notices: z.array(receiptNoticeSchema).max(RECEIPT_NOTICES_PER_CLAIM),
})
export type DueReceiptNotices = z.infer<typeof dueReceiptNoticesSchema>

/**
 * `GET` and the answer of `PUT /actors/me/receipt-notices` (MOL-129, В-2): «Сообщать, что чек
 * разобран», a switch of its own on the page «Бот», saved on the tap — as the rating reminders'
 * (MOL-103 Р-1), never a field of the settings' form. A block of the bot travels here, since the
 * reminders' answer cannot say it over «chosen».
 */
export const receiptNoticesSettingSchema = z.strictObject({
  off: z.boolean(),
  /** The bot is blocked in Telegram: nothing comes whatever the switches say (review №1). */
  blocked: z.boolean(),
})
export type ReceiptNoticesSetting = z.infer<typeof receiptNoticesSettingSchema>

/** The body of `PUT /actors/me/receipt-notices`. */
export const chooseReceiptNoticesSchema = z.strictObject({ on: z.boolean() })
export type ChooseReceiptNotices = z.infer<typeof chooseReceiptNoticesSchema>
