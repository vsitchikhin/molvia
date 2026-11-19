import { describe, expect, it } from 'vitest'
import { printedClock, printedTimesSay } from '#model/support/printed-time'

describe('printedClock', () => {
  it('brings a printed time to the 24-hour clock, AM and PM read', () => {
    expect(printedClock('14:35')).toBe('14:35')
    expect(printedClock('9:10 AM')).toBe('09:10')
    expect(printedClock('9:40 p.m.')).toBe('21:40')
    expect(printedClock('12:05 AM')).toBe('00:05')
    expect(printedClock('12:05 PM')).toBe('12:05')
  })

  it('has no time for one that cannot be', () => {
    for (const t of ['16:66', '25:10', '13:10 PM', '0:10 AM', 'вчера', null])
      expect(printedClock(t)).toBeNull()
  })
})

describe('printedTimesSay', () => {
  it('says the same time, another an hour apart, and a doubt under an hour', () => {
    expect(printedTimesSay('9:10 PM', '21:10')).toBe('same')
    expect(printedTimesSay('09:12', '19:40')).toBe('apart')
    expect(printedTimesSay('14:35', '15:35')).toBe('apart')
    expect(printedTimesSay('14:35', '15:34')).toBeNull()
  })

  it('takes a difference of the font’s 5↔6, two at most, for a doubt', () => {
    expect(printedTimesSay('15:35', '16:35')).toBeNull()
    expect(printedTimesSay('15:35', '16:36')).toBeNull()
    expect(printedTimesSay('5:35 PM', '6:35 PM')).toBeNull()
    expect(printedTimesSay('15:55', '16:66')).toBeNull()
    expect(printedTimesSay('15:35', '17:35')).toBe('apart')
  })
})
