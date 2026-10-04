import { z } from 'zod'
import {
  ERROR,
  ISSUE,
  botApiSecretSchema,
  botFailureSchema,
  confirmLoginSchema,
  dueReceiptNoticesSchema,
  dueRemindersSchema,
  eraseMeSchema,
  feedbackFromBotAnswerSchema,
  feedbackFromBotSchema,
  feedbackPictureSchema,
  loginCodeSchema,
  loginPreviewCodec,
  ownerNoticesSchema,
  ownerNoticesSentSchema,
  rateFromBotSchema,
  replyDeliveredSchema,
  switchRemindersFromBotSchema,
  verdictPathSchema,
} from '@molvia/model'
import type {
  BotFailure,
  DueReceiptNotices,
  DueReminders,
  FeedbackFromBot,
  FeedbackFromBotAnswer,
  FeedbackPicture,
  LoginPreview,
  OwnerNotices,
  ReminderSwitch,
  ReplyDelivered,
  TelegramUserId,
} from '@molvia/model'
import { ApiError, createTransport } from './transport'
import type { ClientOptions } from './transport'

export interface BotClientOptions extends Omit<ClientOptions, 'credentials'> {
  readonly secret: string
}
export interface MolviaBotClient {
  previewLogin(code: string): Promise<LoginPreview>
  confirmLogin(code: string, telegramUserId: TelegramUserId): Promise<void>
  declineLogin(code: string): Promise<void>
  /** Everything about this Telegram account, gone (MOL-58). Repeats answer the same. */
  eraseMe(telegramUserId: TelegramUserId): Promise<void>
  /** The rating reminders due now, already marked as sent by the API (MOL-101). */
  claimReminders(): Promise<DueReminders>
  /** A press of 1–5 under a reminder: the verdict of whoever pressed. Repeats are harmless. */
  rateFromBot(telegramUserId: TelegramUserId, itemId: string, score: number): Promise<void>
  /**
   * The switch of the reminders (MOL-103): a button pressed, or the bot blocked or unblocked. The
   * same answer whether there was anyone or not; repeats are harmless.
   */
  switchReminders(telegramUserId: TelegramUserId, change: ReminderSwitch): Promise<void>
  /**
   * «Чек разобран» due now, already marked as told by the API (MOL-129). `signal` cuts the wait
   * short, as the owner's notices' does.
   */
  claimReceiptNotices(signal?: AbortSignal): Promise<DueReceiptNotices>
  /** A failure of the bot's own, by its kind and handler (MOL-143): the API fingerprints it. */
  reportFailure(failure: BotFailure): Promise<void>
  /**
   * What the API has queued for the owner, already marked as handed (MOL-143). `signal` cuts the
   * wait short — the bot's stop has a deadline of its own.
   */
  claimOwnerNotices(signal?: AbortSignal): Promise<OwnerNotices>
  /**
   * The notices about these messages went to the owner (MOL-148): they are not handed again. Until
   * this is said, the API hands them again ten minutes on.
   */
  ownerNoticesSent(
    messages: readonly number[],
    signal?: AbortSignal,
    missed?: readonly { readonly message: number; readonly position: number }[],
  ): Promise<void>
  /**
   * A text written to the bot as a reply to one of its messages (MOL-148): the API says what it was
   * — the owner's reply, a person's word in a thread — or `404`, nothing of ours.
   */
  feedbackFromBot(message: FeedbackFromBot): Promise<FeedbackFromBotAnswer>
  /** What became of the owner's reply once sent: the message it went out as, or blocked. */
  replyDelivered(delivery: ReplyDelivered): Promise<void>
  /**
   * A picture of message `number`, to send the owner after its notice (MOL-167): the phone's JPEG or
   * Telegram's id of a photo. `null` where there is none any more — delivered, or past its week.
   */
  feedbackPicture(
    number: number,
    position: number,
    signal?: AbortSignal,
  ): Promise<FeedbackPicture | null>
}

/** An internal client has no session and cannot attach its secret to an arbitrary API path. */
export function createBotClient({ secret, ...options }: BotClientOptions): MolviaBotClient {
  if (!botApiSecretSchema.safeParse(secret).success) throw new ApiError(ERROR.BOT_UNAUTHORIZED)
  const { request } = createTransport({ ...options, credentials: 'omit', botSecret: secret })
  function path(code: string): string {
    if (!loginCodeSchema.safeParse(code).success) throw new ApiError(ISSUE.PATH_INVALID, 'code')
    return `/internal/auth/login/${code}`
  }
  return {
    previewLogin: async (code) => request(path(code), loginPreviewCodec),
    confirmLogin: async (code, telegramUserId) => {
      const body = confirmLoginSchema.safeParse({ telegramUserId })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'telegramUserId')
      await request(`${path(code)}/confirm`, z.undefined(), { method: 'POST', body: body.data })
    },
    declineLogin: async (code) => {
      await request(`${path(code)}/decline`, z.undefined(), { method: 'POST' })
    },
    eraseMe: async (telegramUserId) => {
      const body = eraseMeSchema.safeParse({ telegramUserId })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'telegramUserId')
      await request('/internal/actors/erase', z.undefined(), { method: 'POST', body: body.data })
    },
    claimReminders: async () =>
      request('/internal/reminders/claim', dueRemindersSchema, { method: 'POST' }),
    rateFromBot: async (telegramUserId, itemId, score) => {
      const path = verdictPathSchema.safeParse({ itemId })
      if (!path.success) throw new ApiError(ISSUE.PATH_INVALID, 'itemId')
      const body = rateFromBotSchema.safeParse({ telegramUserId, score })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'score')
      await request(`/internal/verdicts/${path.data.itemId}`, z.undefined(), {
        method: 'PUT',
        body: body.data,
      })
    },
    switchReminders: async (telegramUserId, change) => {
      const body = switchRemindersFromBotSchema.safeParse({ telegramUserId, change })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'telegramUserId')
      await request('/internal/reminders/switch', z.undefined(), {
        method: 'POST',
        body: body.data,
      })
    },
    reportFailure: async (failure) => {
      const body = botFailureSchema.safeParse(failure)
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'failure')
      await request('/internal/failures', z.undefined(), { method: 'POST', body: body.data })
    },
    feedbackFromBot: async (message) => {
      const body = feedbackFromBotSchema.safeParse(message)
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'message')
      return request('/internal/feedback/reply', feedbackFromBotAnswerSchema, {
        method: 'POST',
        body: body.data,
      })
    },
    replyDelivered: async (delivery) => {
      const body = replyDeliveredSchema.safeParse(delivery)
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'delivery')
      await request('/internal/feedback/delivered', z.undefined(), {
        method: 'POST',
        body: body.data,
      })
    },
    ownerNoticesSent: async (messages, signal, missed) => {
      const body = ownerNoticesSentSchema.safeParse({
        messages,
        ...(missed === undefined || missed.length === 0 ? {} : { missed }),
      })
      if (!body.success) throw new ApiError(ISSUE.BODY_INVALID, 'messages')
      await request('/internal/owner/sent', z.undefined(), {
        method: 'POST',
        body: body.data,
        ...(signal === undefined ? {} : { signal }),
      })
    },
    feedbackPicture: async (number, position, signal) => {
      if (!Number.isSafeInteger(number) || number < 1)
        throw new ApiError(ISSUE.PATH_INVALID, 'number')
      if (!Number.isSafeInteger(position) || position < 1) {
        throw new ApiError(ISSUE.PATH_INVALID, 'position')
      }
      try {
        return await request(
          `/internal/feedback/${String(number)}/pictures/${String(position)}`,
          feedbackPictureSchema,
          signal === undefined ? {} : { signal },
        )
      } catch (error) {
        if (error instanceof ApiError && error.code === ERROR.NOT_FOUND) return null
        throw error
      }
    },
    claimReceiptNotices: async (signal) =>
      request('/internal/receipts/claim', dueReceiptNoticesSchema, {
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
      }),
    claimOwnerNotices: async (signal) =>
      request('/internal/owner/claim', ownerNoticesSchema, {
        method: 'POST',
        ...(signal === undefined ? {} : { signal }),
      }),
  }
}
