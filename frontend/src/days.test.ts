import { describe, expect, it } from 'vitest'
import { yerevanDate } from '@molvia/model'
import { dayOfAnyYear, dayWords, localDay, monthOf, purchaseDay, timeOfDay } from '@/days'

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

  it('С-7: a phone clock behind the server still calls a purchase from just now today', () => {
    expect(purchaseDay(at(19, 23, 59), 'ru', at(19, 12))).toBe('сегодня')
    expect(purchaseDay(at(20, 0, 5), 'ru', at(19, 23, 58))).toBe('сегодня')
  })
})

describe('timeOfDay', () => {
  it('names the clock with two digits', () => {
    expect(timeOfDay(at(18, 21, 40), 'ru')).toBe('21:40')
    expect(timeOfDay(at(18, 9, 5), 'ru')).toBe('09:05')
  })

  it('midnight is a time like any other', () => {
    // `hour12` is the locale's business, but a zero hour is where an hour-less format shows:
    // «0:05» and «00:05» are different strings, and the strip prints one of them every night.
    expect(timeOfDay(at(18, 0, 5), 'ru')).toBe('00:05')
  })
})

describe('dayOfAnyYear (MOL-57, self-review С-5)', () => {
  it('this year it is the purchase day, words included', () => {
    expect(dayOfAnyYear(at(18, 9), 'ru', at(19, 21))).toBe('вчера')
    expect(dayOfAnyYear(at(1, 9), 'ru', at(19, 21))).toBe('1 сент.')
  })

  it('another year carries the year', () => {
    expect(dayOfAnyYear(new Date(2025, 8, 12), 'ru', at(19, 12))).toBe('12 сент. 2025 г.')
    expect(dayOfAnyYear(new Date(2025, 11, 30, 20), 'ru', new Date(2026, 0, 1, 9))).toBe(
      '30 дек. 2025 г.',
    )
  })

  it('across New Year yesterday is still «вчера», not a date with a year', () => {
    expect(dayOfAnyYear(new Date(2025, 11, 31, 20), 'ru', new Date(2026, 0, 1, 9))).toBe('вчера')
  })
})

describe('monthOf (MOL-66)', () => {
  it('names the month and the year, without the «г.» Russian adds', () => {
    expect(monthOf('2026-09', 'ru')).toBe('сентябрь 2026')
    expect(monthOf('2026-09', 'en')).toBe('September 2026')
    // The first and the last month: the number is a month, not an index.
    expect(monthOf('2027-01', 'ru')).toBe('январь 2027')
    expect(monthOf('2026-12', 'en')).toBe('December 2026')
  })
})

describe('localDay (MOL-121)', () => {
  it('is the phone’s day, not Yerevan’s: at 20:30 UTC it is still the 28th here', () => {
    // The tests run in UTC, west of Yerevan, where its midnight has already passed.
    const evening = new Date('2026-09-28T20:30:00Z')
    expect(yerevanDate(evening)).toBe('2026-09-29')
    expect(localDay(evening)).toBe('2026-09-28')
  })

  it('reads the calendar of the phone to the last minute, month and day in two digits', () => {
    expect(localDay(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30')
    expect(localDay(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01')
  })
})

describe('dayWords (MOL-121, В-1)', () => {
  it('names the phone’s today and yesterday in words, other days by the date', () => {
    expect(dayWords('2026-09-28', 'ru', '2026-09-28')).toBe('Сегодня')
    expect(dayWords('2026-09-27', 'ru', '2026-09-28')).toBe('Вчера')
    expect(dayWords('2026-09-27', 'en', '2026-09-28')).toBe('Yesterday')
    expect(dayWords('2026-09-26', 'ru', '2026-09-28')).toBe('26 сент.')
  })

  it('counts day against day across a month and a year', () => {
    expect(dayWords('2026-09-30', 'ru', '2026-10-01')).toBe('Вчера')
    expect(dayWords('2026-12-31', 'ru', '2027-01-01')).toBe('Вчера')
  })

  it('a day the phone has not reached — written further east — is a date, never «Сегодня»', () => {
    expect(dayWords('2026-09-29', 'ru', '2026-09-28')).toBe('29 сент.')
  })

  it('says «today» of the phone’s day while Yerevan is already on the next one', () => {
    const evening = new Date('2026-09-28T20:30:00Z')
    expect(dayWords('2026-09-28', 'en', localDay(evening))).toBe('Today')
    expect(dayWords('2026-09-29', 'en', localDay(evening))).toBe('Sep 29')
  })
})
