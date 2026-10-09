import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  DomainError,
  ERROR,
  FEEDBACK_PICTURES_MAX,
  botFailureSchema,
  broadcastDoneSchema,
  confirmLoginSchema,
  dueBroadcastSchema,
  dueReceiptNoticesSchema,
  dueRemindersSchema,
  eraseMeSchema,
  feedbackFromBotAnswerSchema,
  feedbackFromBotSchema,
  feedbackPictureSchema,
  loginPreviewCodec,
  ownerNoticesSchema,
  ownerNoticesSentSchema,
  rateFromBotSchema,
  replyDeliveredSchema,
  switchRemindersFromBotSchema,
} from '@molvia/model'
import type {
  BotFailure,
  BroadcastDone,
  DueBroadcast,
  DueReceiptNotices,
  DueReminders,
  FeedbackFromBot,
  FeedbackFromBotAnswer,
  FeedbackPicture,
  LoginPreview,
  OwnerNotices,
  OwnerNoticesSent,
  RateFromBot,
  ReplyDelivered,
  SwitchRemindersFromBot,
  TelegramUserId,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { parseBody, parseQuery, resourceId } from '@/parse'
import { refuseAnyBody } from './empty-body'

/** A message's number and a picture's place in it, as the path spells them. */
const pictureAddress = z.strictObject({
  number: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  position: z.coerce.number().int().min(1).max(FEEDBACK_PICTURES_MAX),
})

export function internalAuthRoutes(
  app: FastifyInstance,
  api: {
    secret: string | null
    preview(code: string): Promise<LoginPreview>
    confirm(code: string, telegramUserId: TelegramUserId): Promise<void>
    decline(code: string): Promise<void>
    erase(telegramUserId: TelegramUserId): Promise<void>
    claimReminders(): Promise<DueReminders>
    rateFromBot(itemId: string, body: RateFromBot): Promise<void>
    switchReminders(body: SwitchRemindersFromBot): Promise<void>
    claimReceiptNotices(): Promise<DueReceiptNotices>
    reportFailure(body: BotFailure): Promise<void>
    claimOwnerNotices(): Promise<OwnerNotices>
    ownerNoticesSent(body: OwnerNoticesSent): Promise<void>
    feedbackFromBot(body: FeedbackFromBot): Promise<FeedbackFromBotAnswer>
    replyDelivered(body: ReplyDelivered): Promise<void>
    feedbackPicture(number: number, position: number): Promise<FeedbackPicture | null>
    claimBroadcast(): Promise<DueBroadcast>
    broadcastDone(body: BroadcastDone): Promise<void>
  },
): void {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest()
  app.register((scope, _options, done) => {
    scope.addHook('onRequest', (request, reply, next) => {
      reply.header('cache-control', 'no-store')
      const authorization = request.headers.authorization ?? ''
      if (!api.secret || !timingSafeEqual(digest(authorization), digest(`Bearer ${api.secret}`))) {
        throw new DomainError(ERROR.BOT_UNAUTHORIZED)
      }
      next()
    })
    scope.get<{ Params: { code: string } }>(
      '/internal/auth/login/:code',
      { onRequest: refuseAnyBody, exposeHeadRoute: false },
      async (request) => {
        parseQuery(z.strictObject({}), request.query)
        return z.encode(loginPreviewCodec, await api.preview(request.params.code))
      },
    )
    scope.post<{ Params: { code: string } }>(
      '/internal/auth/login/:code/confirm',
      async (request, reply) => {
        parseQuery(z.strictObject({}), request.query)
        const body = parseBody(confirmLoginSchema, request.body)
        await api.confirm(request.params.code, body.telegramUserId)
        return reply.code(204).send()
      },
    )
    scope.post<{ Params: { code: string } }>(
      '/internal/auth/login/:code/decline',
      { onRequest: refuseAnyBody },
      async (request, reply) => {
        parseQuery(z.strictObject({}), request.query)
        await api.decline(request.params.code)
        return reply.code(204).send()
      },
    )
    // Behind the same secret as the login, because it is the same caller asking for the same
    // kind of thing: an act Telegram vouched for, which the API cannot check by itself (MOL-58).
    scope.post('/internal/actors/erase', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      const body = parseBody(eraseMeSchema, request.body)
      await api.erase(body.telegramUserId)
      return reply.code(204).send()
    })
    // The rating reminder (MOL-101): the bot asks for what is due and sends it, and a press of
    // 1–5 under it rates for the account that pressed — the same caller, the same secret.
    scope.post('/internal/reminders/claim', { onRequest: refuseAnyBody }, async (request) => {
      parseQuery(z.strictObject({}), request.query)
      return dueRemindersSchema.parse(await api.claimReminders())
    })
    scope.put<{ Params: { itemId: string } }>(
      '/internal/verdicts/:itemId',
      async (request, reply) => {
        parseQuery(z.strictObject({}), request.query)
        const itemId = resourceId(request.params.itemId)
        await api.rateFromBot(itemId, parseBody(rateFromBotSchema, request.body))
        return reply.code(204).send()
      },
    )
    // The switch (MOL-103): a button under a reminder, or Telegram saying the bot was blocked or
    // unblocked. `204` whether there was anyone or not — «off» is true of nobody too.
    scope.post('/internal/reminders/switch', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      await api.switchReminders(parseBody(switchRemindersFromBotSchema, request.body))
      return reply.code(204).send()
    })
    // «Чек разобран» (MOL-129): the receipts read that no phone was handed, marked as told on the way.
    scope.post('/internal/receipts/claim', { onRequest: refuseAnyBody }, async (request) => {
      parseQuery(z.strictObject({}), request.query)
      return dueReceiptNoticesSchema.parse(await api.claimReceiptNotices())
    })
    // The bot's own failures and the owner's channel (MOL-143): the same caller, the same secret.
    // A report is the bot's word about itself; whose update it was never travels.
    scope.post('/internal/failures', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      await api.reportFailure(parseBody(botFailureSchema, request.body))
      return reply.code(204).send()
    })
    scope.post('/internal/owner/claim', { onRequest: refuseAnyBody }, async (request) => {
      parseQuery(z.strictObject({}), request.query)
      return ownerNoticesSchema.parse(await api.claimOwnerNotices())
    })
    // The notices about messages the bot sent (MOL-148): those are not handed again.
    scope.post('/internal/owner/sent', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      await api.ownerNoticesSent(parseBody(ownerNoticesSentSchema, request.body))
      return reply.code(204).send()
    })
    // «Написать разработчику» in the bot (MOL-148): a text written as a reply to the bot — the
    // owner's reply or a person's word — and what became of a reply sent. Who is the owner, and
    // whose thread it is, is decided here; the bot passes `ctx.from.id` and the message.
    scope.post('/internal/feedback/reply', async (request) => {
      parseQuery(z.strictObject({}), request.query)
      const body = parseBody(feedbackFromBotSchema, request.body)
      return feedbackFromBotAnswerSchema.parse(await api.feedbackFromBot(body))
    })
    scope.post('/internal/feedback/delivered', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      await api.replyDelivered(parseBody(replyDeliveredSchema, request.body))
      return reply.code(204).send()
    })
    // A picture of a message, fetched by the bot to send the owner after the notice (MOL-167, Р-5):
    // the phone's JPEG or Telegram's id; `404` once delivered, past its week, or never there.
    scope.get<{ Params: { number: string; position: string } }>(
      '/internal/feedback/:number/pictures/:position',
      { onRequest: refuseAnyBody, exposeHeadRoute: false },
      async (request) => {
        parseQuery(z.strictObject({}), request.query)
        // A malformed address is a missing one, as every address of the API (MOL-25, Р-3).
        const address = pictureAddress.safeParse(request.params)
        if (!address.success) throw new DomainError(ERROR.NOT_FOUND)
        const picture = await api.feedbackPicture(address.data.number, address.data.position)
        if (picture === null) throw new DomainError(ERROR.NOT_FOUND)
        return feedbackPictureSchema.parse(picture)
      },
    )
    // The message to people about a leak (MOL-237): a batch at a time, the API deciding who; the
    // bot's word on a batch is what moves it on, so a batch never reported goes out again.
    scope.post('/internal/broadcasts/claim', { onRequest: refuseAnyBody }, async (request) => {
      parseQuery(z.strictObject({}), request.query)
      return dueBroadcastSchema.parse(await api.claimBroadcast())
    })
    scope.post('/internal/broadcasts/done', async (request, reply) => {
      parseQuery(z.strictObject({}), request.query)
      await api.broadcastDone(parseBody(broadcastDoneSchema, request.body))
      return reply.code(204).send()
    })
    done()
  })
}
