import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, FEEDBACK_DAY_LIMIT } from '@molvia/model'
import type { FeedbackBody } from '@molvia/model'
import type { FeedbackRepository, FeedbackWrite } from '@/db/feedback-repository'
import { heavyFeedbackLimit, sendFeedback } from './send-feedback'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OWNER = 700_000_001

const message: FeedbackBody = {
  kind: 'idea',
  text: 'Хочу видеть цены в рублях',
  locale: 'ru',
  pageBuild: null,
  route: 'settings',
  platform: 'android 15 browser',
  fromError: false,
  errorCode: null,
  clientKey: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
}

function fake(write: FeedbackWrite, calls: unknown[][]): Pick<FeedbackRepository, 'record'> {
  return {
    record: (...args) => {
      calls.push(args)
      return Promise.resolve(write)
    },
  }
}

describe('sendFeedback', () => {
  it('writes the session’s owner with the API’s own build and the day’s limit of the domain', async () => {
    const calls: unknown[][] = []

    const answer = await sendFeedback(
      fake({ kind: 'written', number: 42 }, calls),
      ACTOR,
      message,
      'v0.2.0',
      OWNER,
    )

    expect(answer).toEqual({ sent: { number: 42 }, created: true })
    expect(calls).toEqual([[ACTOR, message, [], 'v0.2.0', FEEDBACK_DAY_LIMIT, true]])
  })

  it('queues nothing for the owner where there is none — every copy and end-to-end', async () => {
    const calls: unknown[][] = []

    await sendFeedback(fake({ kind: 'written', number: 42 }, calls), ACTOR, message, 'dev', null)

    expect(calls).toEqual([[ACTOR, message, [], 'dev', FEEDBACK_DAY_LIMIT, false]])
  })

  it('answers a repeat with the number written before, as not created', async () => {
    const answer = await sendFeedback(
      fake({ kind: 'repeated', number: 42 }, []),
      ACTOR,
      message,
      'dev',
      OWNER,
    )

    expect(answer).toEqual({ sent: { number: 42 }, created: false })
  })

  it('hands the repository the pictures stripped, and writes nothing for a picture refused', async () => {
    const calls: unknown[][] = []
    const screenshot = (width: number) =>
      Buffer.from([
        ...[0xff, 0xd8],
        ...[0xff, 0xe1, 0x00, 0x08, ...Buffer.from('GPS:1', 'latin1'), 0x00],
        ...[0xff, 0xc0, 0x00, 0x08, 0x08, 0x09, 0xfc, width >> 8, width & 0xff, 0x01],
        ...[0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x55, 0xff, 0xd9],
      ]).toString('base64')

    await sendFeedback(
      fake({ kind: 'written', number: 42 }, calls),
      ACTOR,
      { ...message, pictures: [screenshot(1179)] },
      'dev',
      OWNER,
    )
    const [handed] = calls[0]?.[2] as { image: Buffer; width: number; height: number }[]
    expect(handed).toMatchObject({ width: 1179, height: 2556 })
    expect(handed?.image.includes(Buffer.from('GPS'))).toBe(false)

    const refused = sendFeedback(
      fake({ kind: 'written', number: 43 }, calls),
      ACTOR,
      { ...message, pictures: [screenshot(1179), screenshot(50)] },
      'dev',
      OWNER,
    )
    await expect(refused).rejects.toMatchObject({ code: ERROR.FEEDBACK_PICTURE_INVALID })
    expect(calls).toHaveLength(1)
  })

  it('refuses past the day’s limit by its own code', async () => {
    const sent = sendFeedback(fake({ kind: 'limited' }, []), ACTOR, message, 'dev', OWNER)

    await expect(sent).rejects.toBeInstanceOf(DomainError)
    await expect(sent).rejects.toMatchObject({ code: ERROR.FEEDBACK_RATE_LIMITED })
  })
})

describe('heavyFeedbackLimit (адверсариальное А3)', () => {
  const HOUR = 60 * 60 * 1000

  it('ровно предел за скользящие сутки, у каждого свой; через сутки — снова', () => {
    const limit = heavyFeedbackLimit(3)

    expect([0, 1, 2, 3].map((i) => limit('anna', i * HOUR))).toEqual([true, true, true, false])
    expect(limit('boris', 4 * HOUR)).toBe(true)
    // The first went out of the window a day after it came.
    expect(limit('anna', 24 * HOUR)).toBe(true)
    expect(limit('anna', 24 * HOUR + 1)).toBe(false)
  })

  it('отказанное не считается: память держит не больше предела на человека', () => {
    const limit = heavyFeedbackLimit(2)
    for (let i = 0; i < 100; i++) limit('anna', i)
    expect(limit('anna', 24 * HOUR)).toBe(true)
  })
})
