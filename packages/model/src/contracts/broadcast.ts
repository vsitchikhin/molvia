import { z } from 'zod'
import { ISSUE } from '#model/support/errors'
import { visibleText } from '#model/support/text'
import { telegramUserIdSchema } from '#model/entities/actor'

/**
 * The message to people about a leak (MOL-237): what the owner wrote, sent as it is — Russian, then
 * English, in one message, since nobody's language is kept (В-2). Plain text: no markup to escape in
 * the middle of an incident. Telegram takes 4096 characters counted in UTF-16 units, an emoji as two;
 * zod's `max` counts code points, an emoji as one, so the length is held here once more by `length`.
 */
export const BROADCAST_TEXT_MAX = 4096
export const broadcastTextSchema = visibleText(BROADCAST_TEXT_MAX).refine(
  (text) => text.length <= BROADCAST_TEXT_MAX,
)

/** How many people one claim hands the bot: about a second of Telegram's pace. */
export const BROADCAST_BATCH = 25

/**
 * One person of a batch: whose chat, and where they stand in the broadcast's order. The position is
 * what the bot says back when it has written to them — the API moves on only by that word, so a
 * batch the bot never reported goes out again (better twice than never).
 */
export const broadcastRecipientSchema = z.strictObject({
  telegramUserId: telegramUserIdSchema,
  position: z.uuid(),
})
export type BroadcastRecipient = z.infer<typeof broadcastRecipientSchema>

/** `POST /internal/broadcasts/claim`: the next batch of the oldest broadcast going, or nothing. */
export const dueBroadcastSchema = z.strictObject({
  broadcast: z
    .strictObject({
      id: z.int().positive(),
      text: z.string().min(1).max(BROADCAST_TEXT_MAX),
      recipients: z.array(broadcastRecipientSchema).min(1).max(BROADCAST_BATCH),
    })
    .nullable(),
})
export type DueBroadcast = z.infer<typeof dueBroadcastSchema>

/**
 * `POST /internal/broadcasts/done`: the bot went through the batch up to `through` — everybody
 * before it in the batch included — and this is what became of them. A part of a batch, when
 * Telegram's flood control stopped it.
 */
export const broadcastDoneSchema = z
  .strictObject({
    id: z.int().positive(),
    through: z.uuid(),
    sent: z.int().min(0).max(BROADCAST_BATCH),
    blocked: z.int().min(0).max(BROADCAST_BATCH),
    failed: z.int().min(0).max(BROADCAST_BATCH),
  })
  .refine(
    ({ sent, blocked, failed }) => {
      const total = sent + blocked + failed
      return total >= 1 && total <= BROADCAST_BATCH
    },
    { error: ISSUE.BODY_INVALID },
  )
export type BroadcastDone = z.infer<typeof broadcastDoneSchema>
