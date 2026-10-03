import { describe, expect, it } from 'vitest'
import { ERROR, ISSUE } from '#model/support/errors'
import {
  FEEDBACK_QUOTE_MAX,
  FEEDBACK_TEXT_MAX,
  feedbackAttachedSchema,
  feedbackBodySchema,
  feedbackErrorCodeSchema,
  feedbackPlatformSchema,
  feedbackQuote,
  feedbackSentCodec,
} from '#model/contracts/feedback'
import {
  FEEDBACK_NOTICE_KINDS,
  OWNER_NOTICE_KINDS,
  ownerNoticeSchema,
} from '#model/contracts/failure'

const body = {
  kind: 'bug',
  text: 'Не открывается «Деньги»',
  locale: 'ru',
  pageBuild: 'v0.1.3-20-gd90f9cee',
  route: 'money',
  platform: 'ios 18 app',
  fromError: true,
  errorCode: 'error.internal',
  clientKey: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
}

const issueOf = (input: unknown) => feedbackBodySchema.safeParse(input).error?.issues[0]

describe('feedbackBodySchema', () => {
  it('reads a message from an error screen, and one from the settings with nothing known', () => {
    expect(feedbackBodySchema.parse(body)).toEqual(body)
    const plain = { ...body, kind: 'idea', fromError: false, errorCode: null, pageBuild: null }
    expect(feedbackBodySchema.parse(plain)).toEqual(plain)
  })

  it('takes no kind it was not given — the person chooses it', () => {
    expect(issueOf({ ...body, kind: undefined })?.path).toEqual(['kind'])
    expect(issueOf({ ...body, kind: '' })?.path).toEqual(['kind'])
    expect(issueOf({ ...body, kind: 'review' })?.path).toEqual(['kind'])
  })

  it('holds the text to what draws, up to the bound and no further', () => {
    expect(issueOf({ ...body, text: '' })?.path).toEqual(['text'])
    expect(issueOf({ ...body, text: '   \n  ' })?.message).toBe(ISSUE.TEXT_NOT_VISIBLE)
    expect(issueOf({ ...body, text: '\u200B\u2060' })?.message).toBe(ISSUE.TEXT_NOT_VISIBLE)
    expect(
      feedbackBodySchema.parse({ ...body, text: 'а'.repeat(FEEDBACK_TEXT_MAX) }).text,
    ).toHaveLength(FEEDBACK_TEXT_MAX)
    expect(issueOf({ ...body, text: 'а'.repeat(FEEDBACK_TEXT_MAX + 1) })?.path).toEqual(['text'])
    expect(feedbackBodySchema.parse({ ...body, text: '  первая\r\n\r\nвторая  ' }).text).toBe(
      'первая\n\nвторая',
    )
  })

  it('carries a code only from an error screen', () => {
    const issue = issueOf({ ...body, fromError: false })
    expect(issue).toMatchObject({ message: ISSUE.BODY_INVALID, path: ['errorCode'] })
    expect(feedbackBodySchema.parse({ ...body, errorCode: null }).errorCode).toBeNull()
  })

  it('refuses a code, a route, a build or a language of another shape', () => {
    expect(issueOf({ ...body, errorCode: 'Internal Server Error' })?.path).toEqual(['errorCode'])
    expect(issueOf({ ...body, route: '/money?month=2026-09' })?.path).toEqual(['route'])
    expect(issueOf({ ...body, route: 'Money' })?.path).toEqual(['route'])
    expect(issueOf({ ...body, pageBuild: 'v1 <script>' })?.path).toEqual(['pageBuild'])
    expect(issueOf({ ...body, pageBuild: 'x'.repeat(65) })?.path).toEqual(['pageBuild'])
    expect(issueOf({ ...body, locale: 'hy' })?.path).toEqual(['locale'])
  })

  it('takes nothing beyond what the sheet shows', () => {
    expect(issueOf({ ...body, userAgent: 'Mozilla/5.0' })?.code).toBe('unrecognized_keys')
  })

  it('names a content by a key of the phone, in lower case only', () => {
    expect(issueOf({ ...body, clientKey: 'abc' })?.path).toEqual(['clientKey'])
    expect(issueOf({ ...body, clientKey: body.clientKey.toUpperCase() })?.path).toEqual([
      'clientKey',
    ])
  })
})

describe('feedbackPlatformSchema', () => {
  it('takes a system from the list, its major version when known, and app or browser', () => {
    for (const line of [
      'ios 18 app',
      'android 15 browser',
      'macos browser',
      'ipados 17 app',
      'other browser',
    ]) {
      expect(feedbackPlatformSchema.safeParse(line).success, line).toBe(true)
    }
  })

  it('refuses anything that would carry more', () => {
    for (const line of [
      'ios 18.1 app',
      'ios 0 app',
      'symbian 9 app',
      'ios 18',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      'ios 18 app ',
      'ios 1000 app',
    ]) {
      expect(feedbackPlatformSchema.safeParse(line).success, line).toBe(false)
    }
  })
})

describe('feedbackSentCodec', () => {
  it('answers with the number alone', () => {
    expect(feedbackSentCodec.parse({ number: 42 })).toEqual({ number: 42 })
    expect(feedbackSentCodec.safeParse({ number: 0 }).success).toBe(false)
    expect(feedbackSentCodec.safeParse({ number: 42, actorId: 'x' }).success).toBe(false)
  })
})

describe('what the sheet may attach', () => {
  // A code the body refuses would make the sheet send nothing at all from the very error screen it
  // is opened on — and blame the person's text (MOL-147, review №5).
  it("takes every code of the registry, the client's own among them", () => {
    for (const code of [...Object.values(ERROR), ...Object.values(ISSUE)]) {
      expect(feedbackErrorCodeSchema.safeParse(code).success, code).toBe(true)
    }
  })

  it("keeps what went with a text by the body's own rules, the code's too", () => {
    const attached = {
      locale: body.locale,
      pageBuild: body.pageBuild,
      route: body.route,
      platform: body.platform,
      fromError: body.fromError,
      errorCode: body.errorCode,
    }
    expect(feedbackAttachedSchema.parse(attached)).toEqual(attached)
    expect(
      feedbackAttachedSchema.safeParse({
        ...attached,
        fromError: false,
        errorCode: 'error.internal',
      }).success,
    ).toBe(false)
  })
})

describe('feedbackQuote — начало ответа в «Продолжении» (MOL-148, Р-10)', () => {
  it('ровно 200 знаков — целиком, 201 — 200 и многоточие', () => {
    const exact = 'а'.repeat(FEEDBACK_QUOTE_MAX)
    expect(feedbackQuote(exact)).toBe(exact)
    expect(feedbackQuote(`${exact}б`)).toBe(`${exact}…`)
  })

  it('режет по знакам, не по половинкам пары', () => {
    const quote = feedbackQuote('🙂'.repeat(FEEDBACK_QUOTE_MAX + 5))
    expect(Array.from(quote)).toHaveLength(FEEDBACK_QUOTE_MAX + 1)
    expect(quote.endsWith('🙂…')).toBe(true)
  })
})

describe('уведомления владельцу о сообщении (MOL-148, Р-9 MOL-150)', () => {
  const notice = {
    kind: 'feedback',
    thread: 42,
    feedbackKind: 'idea',
    text: 'Список своих магазинов',
    locale: 'ru',
    pageBuild: null,
    apiBuild: 'dev',
    route: 'settings',
    platform: 'ios 18 app',
    fromError: false,
    errorCode: null,
    at: '2026-10-03T10:07:00.000Z',
  }

  it('читается каналом владельца', () => {
    expect(ownerNoticeSchema.parse(notice)).toEqual(notice)
    expect(
      ownerNoticeSchema.parse({
        kind: 'feedback_continued',
        thread: 42,
        quote: 'Починили',
        text: 'Спасибо',
        at: '2026-10-03T11:02:00.000Z',
      }),
    ).toMatchObject({ kind: 'feedback_continued' })
  })

  it('не несёт ничего о человеке: лишнее поле — отказ', () => {
    expect(ownerNoticeSchema.safeParse({ ...notice, actorId: 'x' }).success).toBe(false)
    expect(ownerNoticeSchema.safeParse({ ...notice, telegramUserId: 1 }).success).toBe(false)
  })

  it('виды сообщения — ровно те, что канал держит под feedback_id', () => {
    expect(FEEDBACK_NOTICE_KINDS.every((kind) => OWNER_NOTICE_KINDS.includes(kind))).toBe(true)
  })
})
