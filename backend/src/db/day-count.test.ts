import { describe, expect, it } from 'vitest'
import { countOfDay } from './day-count'

describe('countOfDay (MOL-360, MOL-362)', () => {
  it('starts a person who never counted on the phone’s day', () => {
    expect(countOfDay({ day: null, n: 0 }, '2026-11-10')).toEqual({ day: '2026-11-10', n: 0 })
  })

  it('keeps the count of the same day', () => {
    expect(countOfDay({ day: '2026-11-10', n: 7 }, '2026-11-10')).toEqual({
      day: '2026-11-10',
      n: 7,
    })
  })

  it('starts a later day over', () => {
    expect(countOfDay({ day: '2026-11-09', n: 60 }, '2026-11-10')).toEqual({
      day: '2026-11-10',
      n: 0,
    })
  })

  it('counts a day the phone names before the one begun in it: the day only moves on', () => {
    expect(countOfDay({ day: '2026-11-11', n: 60 }, '2026-11-10')).toEqual({
      day: '2026-11-11',
      n: 60,
    })
  })
})
