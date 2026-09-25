import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  confirmLoginSchema,
  loginPollCodec,
  loginPreviewCodec,
  loginStartedCodec,
  SESSIONS_LIMIT,
  sessionViewCodec,
  sessionsResponseCodec,
} from '#model/contracts/auth'

const at = new Date('2026-09-22T12:00:00Z')

describe('login wire contracts', () => {
  it('round-trips dates, including an unknown device', () => {
    const preview = { deviceName: null, createdAt: at, expiresAt: at, confirmed: false }
    expect(loginPreviewCodec.parse(z.encode(loginPreviewCodec, preview))).toEqual(preview)
    const pending = { status: 'pending', expiresAt: at } as const
    expect(loginPollCodec.parse(z.encode(loginPollCodec, pending))).toEqual(pending)
  })

  it('говорит, что запрос подтверждён, но не кем именно', () => {
    // Р-11: Telegram-id не покидает сервер. Боту нужно отличить «уже подтверждён» от «мёртв»
    // (MOL-55, О-2), и для этого хватает булева — чей это аккаунт, ему знать незачем.
    const confirmed = {
      deviceName: 'iPhone · Safari',
      createdAt: at,
      expiresAt: at,
      confirmed: true,
    }
    expect(loginPreviewCodec.parse(z.encode(loginPreviewCodec, confirmed))).toEqual(confirmed)
    expect(
      loginPreviewCodec.safeParse({
        deviceName: null,
        createdAt: at.toISOString(),
        expiresAt: at.toISOString(),
        confirmed: true,
        telegramUserId: 777,
      }).success,
    ).toBe(false)
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

describe('sessions wire contract (MOL-57)', () => {
  const row = {
    id: '0b6f6c1e-3f7a-4c2b-9a53-5b8a5d1e2f00',
    deviceName: 'iPhone · Safari',
    createdAt: at,
    lastSeenAt: at,
    current: true,
  }

  it('round-trips a list with an unknown device', () => {
    const list = {
      sessions: [
        row,
        { ...row, id: '0b6f6c1e-3f7a-4c2b-9a53-5b8a5d1e2f01', deviceName: null, current: false },
      ],
      total: 2,
    }
    expect(sessionsResponseCodec.parse(z.encode(sessionsResponseCodec, list))).toEqual(list)
  })

  it('не пропускает лишнее поле — токен и срок в строку не попадают', () => {
    const wire = { ...z.encode(sessionViewCodec, row), expiresAt: at.toISOString() }
    expect(sessionViewCodec.safeParse(wire).success).toBe(false)
  })

  it('текущей бывает не больше одной строки', () => {
    const wire = z.encode(sessionViewCodec, row)
    expect(
      sessionsResponseCodec.safeParse({
        sessions: [wire, { ...wire, id: '0b6f6c1e-3f7a-4c2b-9a53-5b8a5d1e2f01' }],
        total: 2,
      }).success,
    ).toBe(false)
  })

  it('total не меньше числа строк, а строк не больше предела', () => {
    const wire = z.encode(sessionViewCodec, { ...row, current: false })
    expect(sessionsResponseCodec.safeParse({ sessions: [wire], total: 0 }).success).toBe(false)
    const many = Array.from({ length: SESSIONS_LIMIT + 1 }, () => wire)
    expect(sessionsResponseCodec.safeParse({ sessions: many, total: many.length }).success).toBe(
      false,
    )
    expect(
      sessionsResponseCodec.safeParse({ sessions: many.slice(1), total: many.length }).success,
    ).toBe(true)
  })
})
