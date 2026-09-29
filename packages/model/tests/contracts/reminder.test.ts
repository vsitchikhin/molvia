import { describe, expect, it } from 'vitest'
import { dueRemindersSchema, rateFromBotSchema, reminderSchema } from '#model/contracts/reminder'
import { REMINDER_ITEMS } from '#model/entities/reminder'

const ITEM = {
  itemId: '5b0e7c0e-6d3e-4a53-9c4a-1f1f0b7e2a11',
  name: 'Сыр «Лори»',
  placeName: 'Ереван Сити',
  daysAgo: 1,
}

describe('reminderSchema', () => {
  it('takes a reminder of one to three items', () => {
    expect(reminderSchema.safeParse({ telegramUserId: 777, items: [ITEM], total: 5 }).success).toBe(
      true,
    )
    const four = Array.from({ length: REMINDER_ITEMS + 1 }, () => ITEM)
    expect(reminderSchema.safeParse({ telegramUserId: 777, items: four, total: 4 }).success).toBe(
      false,
    )
    expect(reminderSchema.safeParse({ telegramUserId: 777, items: [], total: 0 }).success).toBe(
      false,
    )
  })

  it('refuses a total below what it carries, and anything of the person but the chat', () => {
    expect(
      reminderSchema.safeParse({ telegramUserId: 777, items: [ITEM, ITEM], total: 1 }).success,
    ).toBe(false)
    expect(
      reminderSchema.safeParse({ telegramUserId: 777, items: [ITEM], total: 1, actorId: 'x' })
        .success,
    ).toBe(false)
  })

  it('refuses today as a day to ask about', () => {
    expect(
      reminderSchema.safeParse({
        telegramUserId: 777,
        items: [{ ...ITEM, daysAgo: 0 }],
        total: 1,
      }).success,
    ).toBe(false)
  })

  it('is carried in a list', () => {
    expect(dueRemindersSchema.safeParse({ reminders: [] }).success).toBe(true)
  })
})

describe('rateFromBotSchema', () => {
  it('takes a score of 1 to 5 and nothing else', () => {
    expect(rateFromBotSchema.safeParse({ telegramUserId: 777, score: 1 }).success).toBe(true)
    expect(rateFromBotSchema.safeParse({ telegramUserId: 777, score: 5 }).success).toBe(true)
    expect(rateFromBotSchema.safeParse({ telegramUserId: 777, score: 0 }).success).toBe(false)
    expect(rateFromBotSchema.safeParse({ telegramUserId: 777, score: 6 }).success).toBe(false)
    expect(
      rateFromBotSchema.safeParse({ telegramUserId: 777, score: 4, review: 'ok' }).success,
    ).toBe(false)
    expect(rateFromBotSchema.safeParse({ telegramUserId: 0, score: 4 }).success).toBe(false)
  })
})
