import { describe, expect, it } from 'vitest'
import {
  BROADCAST_BATCH,
  BROADCAST_TEXT_MAX,
  broadcastDoneSchema,
  broadcastTextSchema,
  dueBroadcastSchema,
} from '@molvia/model'

const POSITION = '10000000-0000-4000-8000-000000000001'

describe('broadcastTextSchema — текст рассылки (MOL-237)', () => {
  it('русский и английский абзацами — как есть, без краёв', () => {
    const text = 'Molvia: 12 октября …\n\nMolvia: on October 12 …'
    expect(broadcastTextSchema.parse(`\n${text}\n\n`)).toBe(text)
  })

  it('Windows-переводы строк — обычные', () => {
    expect(broadcastTextSchema.parse('ru\r\n\r\nen')).toBe('ru\n\nen')
  })

  it('пусто и одни невидимые — отказ', () => {
    expect(broadcastTextSchema.safeParse('').success).toBe(false)
    expect(broadcastTextSchema.safeParse(' \n\u200b\n ').success).toBe(false)
  })

  it('ровно 4096 знаков — да, 4097 — нет; эмодзи считается двумя, как его считает Telegram', () => {
    expect(broadcastTextSchema.safeParse('я'.repeat(BROADCAST_TEXT_MAX)).success).toBe(true)
    expect(broadcastTextSchema.safeParse('я'.repeat(BROADCAST_TEXT_MAX + 1)).success).toBe(false)
    expect(broadcastTextSchema.safeParse(`${'я'.repeat(BROADCAST_TEXT_MAX - 2)}🙂`).success).toBe(
      true,
    )
    expect(broadcastTextSchema.safeParse(`${'я'.repeat(BROADCAST_TEXT_MAX - 1)}🙂`).success).toBe(
      false,
    )
  })

  it('управляющие знаки и смена направления — отказ', () => {
    expect(broadcastTextSchema.safeParse('ru\u0007en').success).toBe(false)
    expect(broadcastTextSchema.safeParse('ru\u202een').success).toBe(false)
  })
})

describe('dueBroadcastSchema', () => {
  it('пусто — null; пачка — от одного до BROADCAST_BATCH', () => {
    expect(dueBroadcastSchema.parse({ broadcast: null })).toEqual({ broadcast: null })
    const recipient = { telegramUserId: 184467331, position: POSITION }
    const batch = (n: number) => ({
      broadcast: { id: 1, text: 'x', recipients: Array.from({ length: n }, () => recipient) },
    })
    expect(dueBroadcastSchema.safeParse(batch(0)).success).toBe(false)
    expect(dueBroadcastSchema.safeParse(batch(BROADCAST_BATCH)).success).toBe(true)
    expect(dueBroadcastSchema.safeParse(batch(BROADCAST_BATCH + 1)).success).toBe(false)
  })
})

describe('broadcastDoneSchema', () => {
  const done = { id: 1, through: POSITION, sent: 1, blocked: 0, failed: 0 }

  it('хотя бы один исход и не больше пачки', () => {
    expect(broadcastDoneSchema.safeParse(done).success).toBe(true)
    expect(broadcastDoneSchema.safeParse({ ...done, sent: 0 }).success).toBe(false)
    expect(
      broadcastDoneSchema.safeParse({ ...done, sent: BROADCAST_BATCH, failed: 1 }).success,
    ).toBe(false)
  })

  it('ничего не ушло — through null и ни одного исхода; иначе отказ', () => {
    const nothing = { id: 1, through: null, sent: 0, blocked: 0, failed: 0 }
    expect(broadcastDoneSchema.safeParse(nothing).success).toBe(true)
    expect(broadcastDoneSchema.safeParse({ ...nothing, sent: 1 }).success).toBe(false)
    expect(broadcastDoneSchema.safeParse({ ...done, through: undefined }).success).toBe(false)
  })

  it('лишнее поле — отказ', () => {
    expect(broadcastDoneSchema.safeParse({ ...done, telegramUserId: 1 }).success).toBe(false)
  })
})
