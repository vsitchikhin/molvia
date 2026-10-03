import { describe, expect, it } from 'vitest'
import { DomainError, ERROR, FEEDBACK_DAY_LIMIT } from '@molvia/model'
import type { FeedbackBody } from '@molvia/model'
import type { FeedbackRepository, FeedbackWrite } from '@/db/feedback-repository'
import { sendFeedback } from './send-feedback'

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
    expect(calls).toEqual([[ACTOR, message, 'v0.2.0', FEEDBACK_DAY_LIMIT, true]])
  })

  it('queues nothing for the owner where there is none — every copy and end-to-end', async () => {
    const calls: unknown[][] = []

    await sendFeedback(fake({ kind: 'written', number: 42 }, calls), ACTOR, message, 'dev', null)

    expect(calls).toEqual([[ACTOR, message, 'dev', FEEDBACK_DAY_LIMIT, false]])
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

  it('refuses past the day’s limit by its own code', async () => {
    const sent = sendFeedback(fake({ kind: 'limited' }, []), ACTOR, message, 'dev', OWNER)

    await expect(sent).rejects.toBeInstanceOf(DomainError)
    await expect(sent).rejects.toMatchObject({ code: ERROR.FEEDBACK_RATE_LIMITED })
  })
})
