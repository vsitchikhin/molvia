import { describe, expect, it } from 'vitest'
import {
  DEVICE_NAME_MAX,
  LOGIN_CODE_MAX,
  deviceNameSchema,
  loginCodeSchema,
  loginRequestSchema,
  newLoginRequestSchema,
  newSessionSchema,
  sessionSchema,
} from '#model/entities/session'

const ID = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function inAnHour(): Date {
  return new Date(Date.now() + 60 * 60 * 1000)
}

describe('loginCodeSchema', () => {
  it('takes the alphabet Telegram accepts, at both ends of its length', () => {
    // `start` takes `[A-Za-z0-9_-]`, up to 64 — their rule, not ours, which is why the length
    // is a named constant and not a 64 typed into a regex.
    expect(loginCodeSchema.parse('a')).toBe('a')
    expect(loginCodeSchema.parse('a'.repeat(LOGIN_CODE_MAX))).toHaveLength(LOGIN_CODE_MAX)
    expect(loginCodeSchema.parse('Ab9_-')).toBe('Ab9_-')
  })

  it('refuses what a `t.me` link could not carry', () => {
    // Base64 that was not made url-safe (`+`, `/`, `=`) is the near miss worth naming: it is
    // what a careless `randomBytes(32).toString('base64')` produces.
    for (const code of ['', 'a'.repeat(LOGIN_CODE_MAX + 1), 'a+b', 'a/b', 'a=b', 'a b', 'a\nb']) {
      expect(loginCodeSchema.safeParse(code).success).toBe(false)
    }
    expect(loginCodeSchema.safeParse('код').success).toBe(false)
  })
})

describe('deviceNameSchema', () => {
  it('trims what it takes, so the column and the entity cannot disagree', () => {
    expect(deviceNameSchema.parse('  iPhone · Safari  ')).toBe('iPhone · Safari')
  })

  it('refuses a name that draws nothing — the measure is the same as any other line', () => {
    // U+2800 is the case that mattered: a braille blank draws nothing and is not `\\s`, which
    // is why the project measures a line by `visibleLine` rather than by whitespace.
    for (const name of ['', '   ', '⠀⠀', '​']) {
      expect(deviceNameSchema.safeParse(name).success).toBe(false)
    }
  })

  it('stops at the same length the column does', () => {
    expect(deviceNameSchema.parse('a'.repeat(DEVICE_NAME_MAX))).toHaveLength(DEVICE_NAME_MAX)
    expect(deviceNameSchema.safeParse('a'.repeat(DEVICE_NAME_MAX + 1)).success).toBe(false)
  })
})

describe('newSessionSchema', () => {
  const opening = { id: ID, actorId: ACTOR, deviceName: 'iPhone · Safari', expiresAt: inAnHour() }

  it('takes what opens a session, and a device with no name', () => {
    expect(newSessionSchema.parse(opening).deviceName).toBe('iPhone · Safari')
    expect(newSessionSchema.parse({ ...opening, deviceName: null }).deviceName).toBeNull()
  })

  it('refuses a session whose end is already behind it', () => {
    // The database says the same through `sessions_lifetime_forward`, but as `23514`, which
    // nothing translates — a 500 where the caller simply passed a bad date.
    expect(newSessionSchema.safeParse({ ...opening, expiresAt: new Date(0) }).success).toBe(false)
    expect(newSessionSchema.safeParse({ ...opening, expiresAt: new Date() }).success).toBe(false)
  })

  it('refuses fields the database owns, so a caller cannot smuggle them past the schema', () => {
    for (const smuggled of [{ tokenHash: 'a'.repeat(64) }, { createdAt: new Date() }]) {
      expect(newSessionSchema.safeParse({ ...opening, ...smuggled }).success).toBe(false)
    }
  })
})

describe('newLoginRequestSchema', () => {
  const asked = { id: ID, code: 'abc', deviceName: null, expiresAt: inAnHour() }

  it('judges the code before a row exists, not after', () => {
    // The point of having it at all (adversarial А1, А5): a code the database would refuse
    // used to leave an untranslated `22001`, and an unusable device name left a row that its
    // own schema would not read back.
    expect(newLoginRequestSchema.parse(asked).code).toBe('abc')
    expect(newLoginRequestSchema.safeParse({ ...asked, code: 'a+b' }).success).toBe(false)
    expect(
      newLoginRequestSchema.safeParse({ ...asked, code: 'a'.repeat(LOGIN_CODE_MAX + 1) }).success,
    ).toBe(false)
  })

  it('has no place for the secret or for the account, which arrive later or hashed', () => {
    expect(newLoginRequestSchema.safeParse({ ...asked, secretHash: 'a'.repeat(64) }).success).toBe(
      false,
    )
    expect(newLoginRequestSchema.safeParse({ ...asked, telegramUserId: 777 }).success).toBe(false)
  })
})

describe('the entities as they come back from a row', () => {
  it('read a session whole, and refuse one with a name that draws nothing', () => {
    const row = {
      id: ID,
      actorId: ACTOR,
      deviceName: 'iPhone · Safari',
      createdAt: new Date(),
      lastSeenAt: new Date(),
      expiresAt: inAnHour(),
    }

    expect(sessionSchema.parse(row).actorId).toBe(ACTOR)
    expect(sessionSchema.safeParse({ ...row, deviceName: '⠀' }).success).toBe(false)
  })

  it('read a login request in each of its four states', () => {
    const row = {
      id: ID,
      code: 'abc',
      deviceName: null,
      telegramUserId: null as number | null,
      createdAt: new Date(),
      expiresAt: inAnHour(),
      consumedAt: null as Date | null,
    }

    expect(loginRequestSchema.parse(row).consumedAt).toBeNull()
    expect(loginRequestSchema.parse({ ...row, telegramUserId: 777_000_123 }).telegramUserId).toBe(
      777_000_123,
    )
    expect(
      loginRequestSchema.parse({ ...row, telegramUserId: 777_000_123, consumedAt: new Date() })
        .consumedAt,
    ).toBeInstanceOf(Date)
    // «This was not me», said before confirming: put out, and no account was ever named.
    expect(loginRequestSchema.parse({ ...row, consumedAt: new Date() }).telegramUserId).toBeNull()
  })

  it('refuse a Telegram id no reply could carry back', () => {
    const row = {
      id: ID,
      code: 'abc',
      deviceName: null,
      telegramUserId: 9_007_199_254_740_992,
      createdAt: new Date(),
      expiresAt: inAnHour(),
      consumedAt: null,
    }

    expect(loginRequestSchema.safeParse(row).success).toBe(false)
  })
})
