import { describe, expect, it } from 'vitest'
import {
  REMINDER_HOUR,
  REMINDER_LAST_HOUR,
  daysBetween,
  isReminderHour,
  localClock,
  planReminder,
  switchReminders,
} from '#model/entities/reminder'
import type { ReminderLadder } from '#model/entities/reminder'

const plan = (ladder: ReminderLadder | null, today: string, ratedSince = false) =>
  planReminder({ ladder, ratedSince, today })

describe('planReminder — the ladder of MOL-101', () => {
  it('asks about yesterday when there is no ladder', () => {
    expect(plan(null, '2026-10-14')).toEqual({ step: 1, from: '2026-10-13', to: '2026-10-13' })
  })

  it('never twice a day', () => {
    const ladder = { step: 1, remindedOn: '2026-10-14', windowFrom: '2026-10-13' } as const
    expect(plan(ladder, '2026-10-14')).toBeNull()
    expect(plan(ladder, '2026-10-14', true)).toBeNull()
  })

  it('climbs to step 2 on the third day after step 1 and not before', () => {
    const ladder = { step: 1, remindedOn: '2026-10-13', windowFrom: '2026-10-12' } as const
    expect(plan(ladder, '2026-10-14')).toBeNull()
    expect(plan(ladder, '2026-10-15')).toBeNull()
    expect(plan(ladder, '2026-10-16')).toEqual({ step: 2, from: '2026-10-12', to: '2026-10-15' })
    // A day missed is not skipped: the step is due until it is sent.
    expect(plan(ladder, '2026-10-18')).toEqual({ step: 2, from: '2026-10-12', to: '2026-10-17' })
  })

  it('climbs to step 3 a week after step 2 and not before', () => {
    const ladder = { step: 2, remindedOn: '2026-10-16', windowFrom: '2026-10-12' } as const
    expect(plan(ladder, '2026-10-22')).toBeNull()
    expect(plan(ladder, '2026-10-23')).toEqual({ step: 3, from: '2026-10-12', to: '2026-10-22' })
  })

  it('keeps silent six calendar months after step 3, then asks only about what came after', () => {
    const ladder = { step: 3, remindedOn: '2026-10-23', windowFrom: '2026-10-12' } as const
    expect(plan(ladder, '2026-10-24')).toBeNull()
    expect(plan(ladder, '2027-04-23')).toBeNull()
    // Yesterday must be inside the new life: the 23rd of April is the first day after the pause.
    expect(plan(ladder, '2027-04-24')).toEqual({ step: 1, from: '2027-04-23', to: '2027-04-23' })
  })

  it('counts months by the calendar, a short month standing in for a missing day', () => {
    const ladder = { step: 3, remindedOn: '2026-08-31', windowFrom: '2026-08-20' } as const
    expect(plan(ladder, '2027-02-28')).toBeNull()
    expect(plan(ladder, '2027-03-01')).toEqual({ step: 1, from: '2027-02-28', to: '2027-02-28' })
  })

  it('starts over after a rating — between steps and during the pause', () => {
    for (const step of [1, 2, 3] as const) {
      const ladder = { step, remindedOn: '2026-10-13', windowFrom: '2026-10-12' }
      expect(plan(ladder, '2026-10-14', true)).toEqual({
        step: 1,
        from: '2026-10-13',
        to: '2026-10-13',
      })
    }
  })

  it('crosses a year', () => {
    const ladder = { step: 1, remindedOn: '2026-12-30', windowFrom: '2026-12-29' } as const
    expect(plan(ladder, '2027-01-02')).toEqual({ step: 2, from: '2026-12-29', to: '2027-01-01' })
  })
})

describe('localClock', () => {
  it('reads the day and hour in Yerevan, whatever the machine’s zone', () => {
    // 14:59 UTC is 18:59 in Yerevan, a minute before the reminder; 20:00 UTC is midnight.
    expect(localClock(new Date('2026-10-14T14:59:00Z'), 'Asia/Yerevan')).toEqual({
      day: '2026-10-14',
      hour: 18,
    })
    expect(localClock(new Date('2026-10-14T15:00:00Z'), 'Asia/Yerevan')).toEqual({
      day: '2026-10-14',
      hour: 19,
    })
    expect(localClock(new Date('2026-10-14T20:00:00Z'), 'Asia/Yerevan')).toEqual({
      day: '2026-10-15',
      hour: 0,
    })
  })

  it('follows a zone that moves its clock', () => {
    // Belgrade is +02:00 in summer and +01:00 in winter.
    expect(localClock(new Date('2026-07-01T17:00:00Z'), 'Europe/Belgrade').hour).toBe(19)
    expect(localClock(new Date('2026-12-01T18:00:00Z'), 'Europe/Belgrade').hour).toBe(19)
  })
})

describe('isReminderHour', () => {
  it('opens at the reminder hour and closes at the last one', () => {
    expect(isReminderHour(REMINDER_HOUR - 1)).toBe(false)
    expect(isReminderHour(REMINDER_HOUR)).toBe(true)
    expect(isReminderHour(REMINDER_LAST_HOUR - 1)).toBe(true)
    expect(isReminderHour(REMINDER_LAST_HOUR)).toBe(false)
  })
})

describe('daysBetween', () => {
  it('counts the person’s days, yesterday being one', () => {
    expect(daysBetween('2026-10-13', '2026-10-14')).toBe(1)
    expect(daysBetween('2026-12-29', '2027-01-02')).toBe(4)
  })
})

describe('switchReminders — the switch of MOL-103', () => {
  it('turns off and on by the person whatever stood before — from either side', () => {
    for (const from of ['settings', 'bot'] as const) {
      expect(switchReminders(null, 'off', from)).toBe('chosen')
      expect(switchReminders('blocked', 'off', from)).toBe('chosen')
      expect(switchReminders('chosen', 'on', from)).toBeNull()
    }
  })

  it('«on» from the settings does not lift a block; a press in the bot does (В-5)', () => {
    expect(switchReminders('blocked', 'on', 'settings')).toBe('blocked')
    expect(switchReminders('blocked', 'on', 'bot')).toBeNull()
  })

  it('a blocked bot turns off only what was on', () => {
    expect(switchReminders(null, 'blocked', 'bot')).toBe('blocked')
    expect(switchReminders('chosen', 'blocked', 'bot')).toBe('chosen')
  })

  it('an unblocked bot turns on only what blocking turned off (В-1)', () => {
    expect(switchReminders('blocked', 'unblocked', 'bot')).toBeNull()
    expect(switchReminders('chosen', 'unblocked', 'bot')).toBe('chosen')
    expect(switchReminders(null, 'unblocked', 'bot')).toBeNull()
  })

  it('a repeat changes nothing', () => {
    expect(switchReminders('chosen', 'off', 'bot')).toBe('chosen')
    expect(switchReminders(null, 'on', 'settings')).toBeNull()
    expect(switchReminders('blocked', 'blocked', 'bot')).toBe('blocked')
  })
})
