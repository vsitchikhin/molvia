import { describe, expect, it } from 'vitest'
import { purchaseDay } from '@/days'

// Built from local parts: the phone's calendar is what counts, whatever zone the test runs in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute)

describe('purchaseDay', () => {
  it('names today and yesterday in words, in the app language', () => {
    expect(purchaseDay(at(19, 9), 'ru', at(19, 21))).toBe('сегодня')
    expect(purchaseDay(at(18, 9), 'ru', at(19, 21))).toBe('вчера')
    expect(purchaseDay(at(18, 9), 'en', at(19, 21))).toBe('yesterday')
  })

  it('counts by the calendar: 23:50 is yesterday at 00:10', () => {
    expect(purchaseDay(at(18, 23, 50), 'ru', at(19, 0, 10))).toBe('вчера')
    expect(purchaseDay(at(19, 0, 10), 'ru', at(19, 23, 50))).toBe('сегодня')
  })

  it('from the day before yesterday on, the date', () => {
    expect(purchaseDay(at(17, 12), 'ru', at(19, 12))).toBe('17 сент.')
    expect(purchaseDay(at(12, 12), 'en', at(19, 12))).toBe('Sep 12')
  })
})
