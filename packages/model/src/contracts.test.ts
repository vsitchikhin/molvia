import { describe, expect, it } from 'vitest'
import { ERROR } from './errors'
import { errorResponseSchema, healthResponseSchema } from './contracts'

describe('the wire contract', () => {
  it('accepts a healthy and a degraded answer', () => {
    expect(healthResponseSchema.parse({ status: 'ok', version: '1.0.0', database: 'up' })).toEqual({
      status: 'ok',
      version: '1.0.0',
      database: 'up',
    })
    expect(
      healthResponseSchema.parse({ status: 'degraded', version: '1.0.0', database: 'down' }).status,
    ).toBe('degraded')
  })

  it('rejects a health answer that invents a state or drops a field', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'fine', version: '1', database: 'up' }).success,
    ).toBe(false)
    expect(healthResponseSchema.safeParse({ status: 'ok', version: '1' }).success).toBe(false)
  })

  it('only accepts error codes that exist in the registry', () => {
    expect(errorResponseSchema.parse({ code: ERROR.NOT_FOUND }).code).toBe(ERROR.NOT_FOUND)
    expect(errorResponseSchema.safeParse({ code: 'error.made_up' }).success).toBe(false)
  })

  it('carries optional details without requiring them', () => {
    expect(errorResponseSchema.parse({ code: ERROR.INVALID_AMOUNT }).details).toBeUndefined()
    expect(
      errorResponseSchema.parse({ code: ERROR.INVALID_AMOUNT, details: '5403,12' }).details,
    ).toBe('5403,12')
  })
})
