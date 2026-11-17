import { describe, expect, it } from 'vitest'
import {
  FF,
  FF_NAMES,
  ffEnvName,
  ffEnvironmentSchema,
  ffFromHeader,
  ffHeaderOf,
  isFfName,
  type FfName,
} from '#model/contracts/ff'

describe('the list of фф', () => {
  it('names every фф in snake case, with what it closes and the task that takes it off', () => {
    expect(FF_NAMES.length).toBeGreaterThan(0)
    for (const name of FF_NAMES) {
      expect(name).toMatch(/^[a-z]+(_[a-z]+)*$/)
      expect(FF[name].meaning.trim()).not.toBe('')
      expect(FF[name].removedBy).toMatch(/^MOL-[1-9]\d*$/)
      // the mechanism's own task is no removal of anything
      expect(FF[name].removedBy).not.toBe('MOL-382')
    }
  })

  it('takes a removal task for one фф only', () => {
    const tasks = FF_NAMES.map((name) => FF[name].removedBy)
    expect(new Set(tasks).size).toBe(tasks.length)
  })

  it('declares venues and payments, the first two (В-4 «а»)', () => {
    expect(FF_NAMES).toEqual(['venues', 'payments'])
  })

  it('knows its own names and nothing of the prototype', () => {
    expect(isFfName('venues')).toBe(true)
    expect(isFfName('Venues')).toBe(false)
    expect(isFfName('toString')).toBe(false)
    expect(isFfName('')).toBe(false)
  })
})

describe('the header', () => {
  it('names the фф that are on in the order of the list', () => {
    expect(ffHeaderOf(new Set(['payments', 'venues']))).toBe('venues,payments')
    expect(ffHeaderOf(new Set(['payments']))).toBe('payments')
  })

  it('is empty when none is on — an answer, not an absence', () => {
    expect(ffHeaderOf(new Set())).toBe('')
    expect(ffFromHeader('')).toEqual(new Set())
  })

  it('reads back what it wrote', () => {
    const sets: ReadonlySet<FfName>[] = [new Set(), new Set(['venues']), new Set(FF_NAMES)]
    for (const on of sets) {
      expect(ffFromHeader(ffHeaderOf(on))).toEqual(on)
    }
  })

  it('passes over a name this build does not know, spaces and a repeat', () => {
    expect(ffFromHeader('tips,venues')).toEqual(new Set(['venues']))
    expect(ffFromHeader(' payments , venues,venues')).toEqual(new Set(['venues', 'payments']))
    expect(ffFromHeader('VENUES,constructor,,')).toEqual(new Set())
  })
})

describe('the environment', () => {
  it('names a variable FF_<NAME>', () => {
    expect(ffEnvName('venues')).toBe('FF_VENUES')
    expect(ffEnvName('payments')).toBe('FF_PAYMENTS')
  })

  it('is off for every фф not set', () => {
    expect(ffEnvironmentSchema.parse({})).toEqual(new Set())
    expect(ffEnvironmentSchema.parse({ FF_VENUES: 'off', PATH: '/bin' })).toEqual(new Set())
  })

  it('turns on exactly the фф set to on', () => {
    expect(ffEnvironmentSchema.parse({ FF_VENUES: 'on', FF_PAYMENTS: 'off' })).toEqual(
      new Set(['venues']),
    )
    expect(ffEnvironmentSchema.parse({ FF_VENUES: 'on', FF_PAYMENTS: 'on' })).toEqual(
      new Set(FF_NAMES),
    )
  })

  it('refuses anything but on and off, so a typo stops the boot', () => {
    for (const value of ['ON', 'true', '1', 'yes', 'on ', '']) {
      expect(ffEnvironmentSchema.safeParse({ FF_PAYMENTS: value }).success).toBe(false)
    }
  })
})
