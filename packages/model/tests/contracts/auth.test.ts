import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  confirmLoginSchema,
  loginPollCodec,
  loginPreviewCodec,
  loginStartedCodec,
} from '#model/contracts/auth'

const at = new Date('2026-09-22T12:00:00Z')

describe('login wire contracts', () => {
  it('round-trips dates, including an unknown device', () => {
    const preview = { deviceName: null, createdAt: at, expiresAt: at }
    expect(loginPreviewCodec.parse(z.encode(loginPreviewCodec, preview))).toEqual(preview)
    const pending = { status: 'pending', expiresAt: at } as const
    expect(loginPollCodec.parse(z.encode(loginPollCodec, pending))).toEqual(pending)
  })

  it('refuses secrets and account identifiers in a waiting response', () => {
    for (const extra of ['token', 'secret', 'secretHash', 'telegramUserId']) {
      expect(
        loginPollCodec.safeParse({ status: 'pending', expiresAt: at.toISOString(), [extra]: 'x' })
          .success,
      ).toBe(false)
    }
  })

  it('only opens an HTTPS Telegram link', () => {
    const input = { id: '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f', expiresAt: at.toISOString() }
    expect(
      loginStartedCodec.safeParse({ ...input, url: 'https://t.me/molvia_bot?start=x' }).success,
    ).toBe(true)
    for (const url of ['http://t.me/x', 'https://example.org', 'javascript:alert(1)']) {
      expect(loginStartedCodec.safeParse({ ...input, url }).success).toBe(false)
    }
  })

  it('confirmation accepts only a safe positive Telegram id', () => {
    for (const telegramUserId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '123']) {
      expect(confirmLoginSchema.safeParse({ telegramUserId }).success).toBe(false)
    }
    expect(confirmLoginSchema.safeParse({ telegramUserId: Number.MAX_SAFE_INTEGER }).success).toBe(
      true,
    )
    expect(confirmLoginSchema.safeParse({ telegramUserId: 1, actorId: 'x' }).success).toBe(false)
  })
})
