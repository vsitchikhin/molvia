import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, FEEDBACK_DAY_LIMIT, FEEDBACK_REPLY_MAX } from '@molvia/model'
import type { FeedbackFromBot } from '@molvia/model'
import type {
  AnsweredReply,
  ContinueThread,
  ContinueWrite,
  FeedbackRepository,
  ReplyWritten,
} from '@/db/feedback-repository'
import { feedbackFromBot } from './feedback-from-bot'

const OWNER = 4242
const ANNA = 1001
const ANNAS_ID = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

type Repository = Pick<FeedbackRepository, 'reply' | 'answeredBy' | 'continueThread'>

function fake(
  answers: {
    reply?: ReplyWritten | null
    answered?: AnsweredReply | null
    continued?: ContinueWrite
  },
  calls: { replies: unknown[][]; continued: ContinueThread[] } = { replies: [], continued: [] },
): Repository {
  return {
    reply: (...args) => {
      calls.replies.push(args)
      return Promise.resolve(answers.reply ?? null)
    },
    answeredBy: () => Promise.resolve(answers.answered ?? null),
    continueThread: (continuation) => {
      calls.continued.push(continuation)
      return Promise.resolve(answers.continued ?? 'written')
    },
  }
}

const fromOwner: FeedbackFromBot = {
  telegramUserId: OWNER,
  repliedMessageId: 499,
  thread: 42,
  text: 'Починили, обновите приложение',
}
const fromAnna: FeedbackFromBot = {
  telegramUserId: ANNA,
  repliedMessageId: 9031,
  thread: null,
  text: 'Обновил, работает',
}
const written: ReplyWritten = {
  reply: 17,
  to: ANNA,
  locale: 'en',
  // 23:30 in Yerevan is the next day there.
  answeredAt: new Date('2026-10-02T19:30:00Z'),
  country: 'AM',
}

describe('feedbackFromBot — ответ владельца (MOL-148, Р-2, Р-3)', () => {
  it('владелец с меткой — ответ записан: кому, на каком языке, от какого дня в поясе человека', async () => {
    const calls = { replies: [] as unknown[][], continued: [] }

    const answer = await feedbackFromBot(fake({ reply: written }, calls), OWNER, fromOwner, 'dev')

    expect(answer).toEqual({
      outcome: 'answered',
      reply: 17,
      to: ANNA,
      locale: 'en',
      day: '2026-10-02',
    })
    expect(calls.replies).toEqual([[42, 'Починили, обновите приложение']])
  })

  it('нити нет — gone с её номером, ничего не отправлять', async () => {
    expect(await feedbackFromBot(fake({ reply: null }), OWNER, fromOwner, 'dev')).toEqual({
      outcome: 'gone',
      thread: 42,
    })
  })

  it('длиннее 3500 — too_long, ничего не записано; ровно 3500 — записано', async () => {
    const calls = { replies: [] as unknown[][], continued: [] }
    const long = { ...fromOwner, text: 'а'.repeat(FEEDBACK_REPLY_MAX + 1) }

    expect(await feedbackFromBot(fake({ reply: written }, calls), OWNER, long, 'dev')).toEqual({
      outcome: 'too_long',
      max: FEEDBACK_REPLY_MAX,
    })
    expect(calls.replies).toEqual([])
    const exact = { ...fromOwner, text: 'а'.repeat(FEEDBACK_REPLY_MAX) }
    expect(await feedbackFromBot(fake({ reply: written }), OWNER, exact, 'dev')).toMatchObject({
      outcome: 'answered',
    })
  })

  it('пустые строки подряд или одни невидимые знаки — invisible', async () => {
    const blank = { ...fromOwner, text: 'да\n\n\nнет' }
    expect(await feedbackFromBot(fake({ reply: written }), OWNER, blank, 'dev')).toEqual({
      outcome: 'invisible',
    })
  })

  it('метка от не владельца — не ответ: ищется продолжение, а его нет — 404', async () => {
    const stranger = { ...fromOwner, telegramUserId: ANNA }
    const sent = feedbackFromBot(fake({ reply: written }), OWNER, stranger, 'dev')

    await expect(sent).rejects.toBeInstanceOf(DomainError)
    await expect(sent).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })

  it('без владельца в окружении ответов нет вовсе', async () => {
    await expect(
      feedbackFromBot(fake({ reply: written }), null, fromOwner, 'dev'),
    ).rejects.toMatchObject({
      code: ERROR.NOT_FOUND,
    })
  })
})

describe('feedbackFromBot — продолжение нити (MOL-148, В-2)', () => {
  const answered = { reply: 17, actorId: ANNAS_ID }

  it('ответ на присланный ответ — продолжение под ключом сообщения Telegram, с пределом формы', async () => {
    const calls = { replies: [], continued: [] as ContinueThread[] }

    const answer = await feedbackFromBot(fake({ answered }, calls), OWNER, fromAnna, 'v0.2.0')

    expect(answer).toEqual({ outcome: 'continued' })
    expect(calls.continued).toEqual([
      {
        reply: answered,
        text: 'Обновил, работает',
        apiBuild: 'v0.2.0',
        limit: FEEDBACK_DAY_LIMIT,
        notify: true,
      },
    ])
  })

  it('без владельца продолжение пишется, но уведомления не ставит', async () => {
    const calls = { replies: [], continued: [] as ContinueThread[] }
    await feedbackFromBot(fake({ answered }, calls), null, fromAnna, 'dev')
    expect(calls.continued[0]?.notify).toBe(false)
  })

  it('владелец, ответивший на свою же рамку, — тоже продолжение: метки в ней нет', async () => {
    const calls = { replies: [] as unknown[][], continued: [] as ContinueThread[] }
    const own = { ...fromAnna, telegramUserId: OWNER }

    expect(await feedbackFromBot(fake({ answered }, calls), OWNER, own, 'dev')).toEqual({
      outcome: 'continued',
    })
    expect(calls.replies).toEqual([])
  })

  it('день кончился — limited; длиннее 2000 — too_long; не нашлось — 404', async () => {
    expect(
      await feedbackFromBot(fake({ answered, continued: 'limited' }), OWNER, fromAnna, 'dev'),
    ).toEqual({ outcome: 'limited' })
    expect(
      await feedbackFromBot(
        fake({ answered }),
        OWNER,
        { ...fromAnna, text: 'а'.repeat(2001) },
        'dev',
      ),
    ).toEqual({ outcome: 'too_long', max: 2000 })
    await expect(feedbackFromBot(fake({}), OWNER, fromAnna, 'dev')).rejects.toMatchObject({
      code: ERROR.NOT_FOUND,
    })
    await expect(
      feedbackFromBot(fake({ answered, continued: 'gone' }), OWNER, fromAnna, 'dev'),
    ).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })

  it('длинный текст на чужое сообщение — 404, а не «слишком длинно»: это не наше', async () => {
    const long = { ...fromAnna, text: 'а'.repeat(3000) }
    await expect(feedbackFromBot(fake({}), OWNER, long, 'dev')).rejects.toMatchObject({
      code: ERROR.NOT_FOUND,
    })
  })
})

describe('feedbackFromBot — фото человека (MOL-167, Р-8, В-3)', () => {
  const answered = { reply: 17, actorId: ANNAS_ID }
  const picture = {
    fileId: 'AgAC-large',
    fileUniqueId: 'AQAD-u',
    width: 1280,
    height: 2772,
    bytes: null,
  }

  it('фото без подписи и с подписью из одних невидимых знаков — слово без текста (ревью 5)', async () => {
    for (const text of [undefined, '⁠', '​ ​']) {
      const calls = { replies: [], continued: [] as ContinueThread[] }
      const word: FeedbackFromBot = {
        ...fromAnna,
        picture,
        ...(text === undefined ? { text: undefined } : { text }),
      }

      const answer = await feedbackFromBot(fake({ answered }, calls), OWNER, word, 'dev')

      expect(answer).toEqual({ outcome: 'continued' })
      expect(calls.continued[0]).toMatchObject({ text: '', picture })
    }
  })

  it('невидимый текст без фото — по-прежнему «нечего отправить»', async () => {
    const answer = await feedbackFromBot(
      fake({ answered }),
      OWNER,
      { ...fromAnna, text: '​' },
      'dev',
    )
    expect(answer).toEqual({ outcome: 'invisible' })
  })
})
