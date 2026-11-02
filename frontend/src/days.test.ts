import { describe, expect, it } from 'vitest'
import { yerevanDate } from '@molvia/model'
import {
  answeredAt,
  calendarDayOfAnyYear,
  dateOfAnyYear,
  dayOfAnyYear,
  dayWords,
  localDay,
  monthOf,
  purchaseDay,
  timeOfDay,
} from '@/days'

// Built from local parts: the phone's calendar is what counts, whatever zone the test runs in.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 8, day, hour, minute)

describe('purchaseDay', () => {
  it('names today and yesterday in words, in the app language', () => {
    expect(purchaseDay(at(19, 9), 'ru', '2026-09-19')).toBe('сегодня')
    expect(purchaseDay(at(18, 9), 'ru', '2026-09-19')).toBe('вчера')
    expect(purchaseDay(at(18, 9), 'en', '2026-09-19')).toBe('yesterday')
  })

  it('counts by the calendar: 23:50 is yesterday at 00:10', () => {
    expect(purchaseDay(at(18, 23, 50), 'ru', '2026-09-19')).toBe('вчера')
    expect(purchaseDay(at(19, 0, 10), 'ru', '2026-09-19')).toBe('сегодня')
  })

  it('from the day before yesterday on, the date', () => {
    expect(purchaseDay(at(17, 12), 'ru', '2026-09-19')).toBe('17 сент.')
    expect(purchaseDay(at(12, 12), 'en', '2026-09-19')).toBe('Sep 12')
  })

  it('С-7: a phone clock behind the server still calls a purchase from just now today', () => {
    expect(purchaseDay(at(19, 23, 59), 'ru', '2026-09-19')).toBe('сегодня')
    expect(purchaseDay(at(20, 0, 5), 'ru', '2026-09-19')).toBe('сегодня')
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

describe('answeredAt (MOL-187)', () => {
  it('names the answer by the day the screen holds, with its time', () => {
    expect(answeredAt(at(19, 23, 40), 'ru', '2026-09-19')).toBe('сегодня, 23:40')
    expect(answeredAt(at(17, 14, 5), 'ru', '2026-09-19')).toBe('17 сент., 14:05')
  })

  it('А2: the same answer, the screen on the next day, is yesterday’s — whatever the clock says', () => {
    expect(answeredAt(at(19, 23, 40), 'en', '2026-09-20')).toBe('yesterday, 11:40 PM')
  })

  // MOL-329, adversarial А4: the clock is never read here — a strip redrawn past midnight said «вчера» over
  // rows still «сегодня». The screen's day moves at midnight itself (`useLocalDay`).
  it('the screen still on yesterday is the day the answer is named by, whatever the clock says', () => {
    expect(answeredAt(at(19, 23, 58), 'en', '2026-09-19')).toBe('today, 11:58 PM')
  })

  it('an answer of another year says its year (MOL-215, adversarial Б2)', () => {
    expect(answeredAt(new Date(2025, 9, 30, 10, 5), 'en', '2026-11-02')).toBe(
      'Oct 30, 2025, 10:05 AM',
    )
    // «Вчера» beats the year, as `dayOfAnyYear` has it.
    expect(answeredAt(new Date(2025, 11, 31, 23, 40), 'en', '2026-01-01')).toBe(
      'yesterday, 11:40 PM',
    )
  })

  it('an answer of a day the screen has not reached yet is today’s, never a date', () => {
    expect(answeredAt(at(20, 0, 10), 'ru', '2026-09-19')).toBe('сегодня, 00:10')
  })
})

describe('dayOfAnyYear (MOL-57, self-review С-5)', () => {
  it('this year it is the purchase day, words included', () => {
    expect(dayOfAnyYear(at(18, 9), 'ru', '2026-09-19')).toBe('вчера')
    expect(dayOfAnyYear(at(1, 9), 'ru', '2026-09-19')).toBe('1 сент.')
  })

  it('another year carries the year', () => {
    expect(dayOfAnyYear(new Date(2025, 8, 12), 'ru', '2026-09-19')).toBe('12 сент. 2025 г.')
    expect(dayOfAnyYear(new Date(2025, 11, 30, 20), 'ru', '2026-01-01')).toBe('30 дек. 2025 г.')
  })

  it('across New Year yesterday is still «вчера», not a date with a year', () => {
    expect(dayOfAnyYear(new Date(2025, 11, 31, 20), 'ru', '2026-01-01')).toBe('вчера')
  })
})

describe('calendarDayOfAnyYear (MOL-305)', () => {
  it('a day of this year is short, another year’s carries its year', () => {
    expect(calendarDayOfAnyYear('2026-10-23', 'ru', '2026-10-30')).toBe('23 окт.')
    expect(calendarDayOfAnyYear('2023-10-26', 'ru', '2026-10-30')).toBe('26 окт. 2023 г.')
    expect(calendarDayOfAnyYear('2026-12-31', 'ru', '2027-01-01')).toBe('31 дек. 2026 г.')
  })

  // A sheet's own day in the form it prints it, the year beside it (MOL-329, adversarial Ж1).
  it('takes the form of its place and adds the year to it', () => {
    const long = { day: 'numeric', month: 'long' } as const
    expect(calendarDayOfAnyYear('2025-09-16', 'en', '2026-11-02', long)).toBe('September 16, 2025')
    expect(calendarDayOfAnyYear('2026-09-16', 'en', '2026-11-02', long)).toBe('September 16')
    const digits = { day: '2-digit', month: '2-digit' } as const
    expect(calendarDayOfAnyYear('2025-09-12', 'ru', '2026-11-02', digits)).toBe('12.09.2025')
    expect(calendarDayOfAnyYear('2026-09-12', 'ru', '2026-11-02', digits)).toBe('12.09')
  })
})

describe('dateOfAnyYear (MOL-204; MOL-329, adversarial А5)', () => {
  it('is always a date, the year only when not the screen’s, the month short or whole', () => {
    expect(dateOfAnyYear(at(18, 9), 'ru', '2026-09-19')).toBe('18 сент.')
    expect(dateOfAnyYear(new Date(2025, 8, 21), 'ru', '2026-09-19')).toBe('21 сент. 2025 г.')
    expect(dateOfAnyYear(new Date(2025, 8, 21), 'en', '2026-09-19', 'long')).toBe(
      'September 21, 2025',
    )
    expect(dateOfAnyYear(at(21, 9), 'ru', '2026-09-22', 'long')).toBe('21 сентября')
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

  it('leaves out the year of the day it is shown on, and only that year (MOL-188, В-2)', () => {
    expect(monthOf('2026-09', 'ru', '2026-10-18')).toBe('сентябрь')
    expect(monthOf('2026-09', 'en', '2026-10-18')).toBe('September')
    // The year before and the one after are said, the first day of the year too.
    expect(monthOf('2025-12', 'ru', '2026-01-01')).toBe('декабрь 2025')
    expect(monthOf('2027-01', 'ru', '2026-12-31')).toBe('январь 2027')
    expect(monthOf('2026-01', 'ru', '2026-01-01')).toBe('январь')
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
    // Four digits of year, as the wire writes a day (adversarial round 3 С).
    const yearOne = new Date(0)
    yearOne.setFullYear(1, 0, 1)
    expect(localDay(yearOne)).toBe('0001-01-01')
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
