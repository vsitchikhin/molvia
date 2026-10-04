import { describe, expect, it } from 'vitest'
import {
  POLICY_VERSION,
  acceptConsentSchema,
  consentNeeded,
  consentSchema,
} from '#model/contracts/consent'

describe('consentNeeded (MOL-95)', () => {
  it('asks whoever accepted no edition — every owner before the column', () => {
    expect(consentNeeded(null, 1)).toBe(true)
  })

  it('asks again only about an edition newer than the accepted one', () => {
    expect(consentNeeded(1, 2)).toBe(true)
    expect(consentNeeded(2, 2)).toBe(false)
  })

  it('does not ask a build older than the edition accepted elsewhere', () => {
    // A phone that has not updated yet cannot show the newer text, so it does not ask about it.
    expect(consentNeeded(3, 2)).toBe(false)
  })

  it('compares with the build’s own edition by default', () => {
    expect(consentNeeded(POLICY_VERSION)).toBe(false)
    expect(consentNeeded(POLICY_VERSION - 1)).toBe(true)
  })
})

describe('acceptConsentSchema', () => {
  it('takes an edition that exists, from the first to the current', () => {
    expect(acceptConsentSchema.parse({ version: 1 })).toEqual({ version: 1 })
    expect(acceptConsentSchema.parse({ version: POLICY_VERSION })).toEqual({
      version: POLICY_VERSION,
    })
  })

  it('refuses an edition before the first, one not yet written, and a fraction', () => {
    expect(acceptConsentSchema.safeParse({ version: 0 }).success).toBe(false)
    expect(acceptConsentSchema.safeParse({ version: POLICY_VERSION + 1 }).success).toBe(false)
    expect(acceptConsentSchema.safeParse({ version: 1.5 }).success).toBe(false)
    expect(acceptConsentSchema.safeParse({ version: '1' }).success).toBe(false)
  })

  it('refuses a moment sent along: the moment is the server’s', () => {
    expect(
      acceptConsentSchema.safeParse({ version: 1, consentedAt: '2026-10-04T00:00:00Z' }).success,
    ).toBe(false)
  })
})

describe('consentSchema', () => {
  it('carries none, or any edition — a server may be newer than the phone', () => {
    expect(consentSchema.parse({ version: null })).toEqual({ version: null })
    expect(consentSchema.parse({ version: POLICY_VERSION + 5 })).toEqual({
      version: POLICY_VERSION + 5,
    })
  })

  it('refuses a field it does not name', () => {
    expect(consentSchema.safeParse({ version: 1, consentedAt: null }).success).toBe(false)
  })
})
