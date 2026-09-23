import { describe, expect, it } from 'vitest'
import {
  DEVICE_NAME_MAX,
  LOGIN_CODE_MAX,
  deviceNameOrNull,
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
    for (const name of ['', '   ', '\u2800\u2800', '\u200B']) {
      expect(deviceNameSchema.safeParse(name).success).toBe(false)
    }
  })

  it('stops at the same length the column does', () => {
    expect(deviceNameSchema.parse('a'.repeat(DEVICE_NAME_MAX))).toHaveLength(DEVICE_NAME_MAX)
    expect(deviceNameSchema.safeParse('a'.repeat(DEVICE_NAME_MAX + 1)).success).toBe(false)
  })
})

describe('deviceNameOrNull', () => {
  it('keeps a name that fits, trimmed, and turns an empty one into nothing', () => {
    expect(deviceNameOrNull('  iPhone · Safari  ')).toBe('iPhone · Safari')
    expect(deviceNameOrNull(null)).toBeNull()
  })

  it('cuts a name that is merely too long instead of losing it', () => {
    // The whole distinction (adversarial Р5): «too long» still tells a person which device
    // they are looking at, «draws nothing» does not. Before, both became null.
    const long = `iPhone · Safari ${'a'.repeat(200)}`

    const cut = deviceNameOrNull(long)

    expect(cut).toHaveLength(DEVICE_NAME_MAX)
    expect(cut?.startsWith('iPhone · Safari')).toBe(true)
  })

  it('repairs a name instead of losing it over a tab or a direction mark', () => {
    // A HTAB is legal inside a header value, and `visibleLine` refuses a break — so one tab
    // used to turn a perfectly good name into «unknown device» (adversarial С3). `pastedLine`
    // is the one-line form of the cleaning `tidyText` does for a review, and it is what the
    // documentation always claimed happened here.
    expect(deviceNameOrNull('iPhone\tSafari')).toBe('iPhone Safari')
    expect(deviceNameOrNull(`iPhone${String.fromCodePoint(0x202e)}Safari`)).toBe('iPhoneSafari')
  })

  it('trims the invisible edge before the cut, not only after it', () => {
    // A hundred braille blanks in front of the name filled the whole budget, so the cut kept
    // the padding and threw away the only part that draws (С3).
    expect(deviceNameOrNull(`${'\u2800'.repeat(100)}iPhone`)).toBe('iPhone')
  })

  it('leaves a cut edge to `trimInvisibleEdges`, which knows more than a surrogate rule', () => {
    // The first version knew one shape of «half a character» — a lone high surrogate — while
    // this same package already decides what may stand at an edge: a selector draws the emoji
    // before it, a run of tags is a flag only when it spells one, a dangling joiner draws
    // nothing (MOL-21, adversarial round 4). A second, poorer rule beside the first is the
    // drift `INVISIBLE` went through twice (С4).
    const family = `${'a'.repeat(76)}\u{1F468}\u200D\u{1F469}\u200D\u{1F467}`
    const scotland = `${'a'.repeat(70)}\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}`

    // The joiner goes with the halves it can no longer join; what is left is a whole character.
    expect(deviceNameOrNull(family)).toBe(`${'a'.repeat(76)}\u{1F468}`)
    // The tags go whole — without their cancel tag they spell no flag — and 🏴 stays. Asserted
    // as the exact string: «contains 🏴 and no cancel tag» is equally true of the broken result,
    // where four of the five tags rode into the column invisibly.
    expect(deviceNameOrNull(scotland)).toBe(`${'a'.repeat(70)}\u{1F3F4}`)
    expect(deviceNameOrNull(scotland)).toHaveLength(72)
  })

  it('drops a combining mark whose letter is the last thing that fits — a known edge', () => {
    // Named rather than fixed (С4): the cut walks code points, so «…é» at the boundary becomes
    // «…e». A plainer name, not a broken one, and the proper fix would carry `Intl.Segmenter`
    // into every browser that loads the domain.
    expect(deviceNameOrNull(`${'a'.repeat(79)}e\u0301`)).toBe(`${'a'.repeat(79)}e`)
  })

  it('never cuts a character in half', () => {
    // The branch nothing else reaches: the 80th UTF-16 unit is the high half of an emoji, and
    // the low half is on the other side of the cut. Half a character is not a shorter name.
    const surrogate = `${'a'.repeat(79)}\u{1F600}${'b'.repeat(40)}`
    expect(surrogate.codePointAt(79)).toBe(0x1f600)

    const cut = deviceNameOrNull(surrogate)

    expect(cut).toBe('a'.repeat(79))
    expect(cut).toHaveLength(79)
    // And the pair survives whole when it fits: 78 letters leave room for both units.
    expect(deviceNameOrNull(`${'a'.repeat(78)}\u{1F600}${'b'.repeat(40)}`)).toBe(
      `${'a'.repeat(78)}\u{1F600}`,
    )
  })

  it('trims again when the cut lands on a space, so no name ends in one', () => {
    const cut = deviceNameOrNull(`${'a'.repeat(79)} tail`)

    expect(cut).toBe('a'.repeat(79))
  })

  it('takes exactly the limit untouched, and one more is cut rather than dropped', () => {
    expect(deviceNameOrNull('a'.repeat(DEVICE_NAME_MAX))).toHaveLength(DEVICE_NAME_MAX)
    expect(deviceNameOrNull('a'.repeat(DEVICE_NAME_MAX + 1))).toHaveLength(DEVICE_NAME_MAX)
  })

  it('turns a name carrying what nobody can be shown into null, and says so', () => {
    // The third outcome, which the first version had without documenting it: a lone surrogate
    // and a private-use glyph are exactly what `pastedLine` leaves «for the form to explain»,
    // and here there is no form — the name is derived from a header (С3).
    expect(deviceNameOrNull(`iPhone${String.fromCodePoint(0xd800)}Safari`)).toBeNull()
    expect(deviceNameOrNull(`iPhone${String.fromCodePoint(0xe000)}Safari`)).toBeNull()
  })

  it('turns a name that draws nothing into null, however long it is', () => {
    for (const name of ['', '   ', '\u2800\u2800', '\u200B', '\u2800'.repeat(200)]) {
      expect(deviceNameOrNull(name)).toBeNull()
    }
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

  it('judges the term against the database clock when it is given, not the process clock', () => {
    // Adversarial А5: the database six minutes behind the API is not a login that ends early.
    const createdAt = new Date(Date.now() - 6 * 60_000)
    const expiresAt = new Date(createdAt.getTime() + 5 * 60_000)
    expect(newLoginRequestSchema.safeParse({ ...asked, createdAt, expiresAt }).success).toBe(true)
    expect(
      newLoginRequestSchema.safeParse({ ...asked, createdAt, expiresAt: createdAt }).success,
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
