import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '@molvia/model'
import { clearSessionCookie, readCookieValues, setSessionCookie } from './cookie'
import { secretOrNull } from './secret'

/** The part of a reply the module touches, recording instead of answering. */
function sink() {
  const headers = new Map<string, string>()
  return {
    headers,
    header(name: string, value: string) {
      headers.set(name, value)
      return this
    },
  }
}

const TOKEN = 'Zm9vYmFyLXRva2VuLTMyLWJ5dGVzLWJhc2U2NHVybA'

/** Что вернул бы прежний `readCookie`: первое значение или ничего. */
const first = (header: string | undefined) => readCookieValues(header, SESSION_COOKIE)[0] ?? null

describe('reading the cookies of one name out of the header', () => {
  it('finds it among others, whatever the spacing', () => {
    expect(first(`a=1; ${SESSION_COOKIE}=${TOKEN}; b=2`)).toBe(TOKEN)
    expect(first(`a=1;${SESSION_COOKIE}=${TOKEN}`)).toBe(TOKEN)
    expect(first(`  ${SESSION_COOKIE}  =  ${TOKEN}  `)).toBe(TOKEN)
  })

  it('answers nothing when there is no header and no such name', () => {
    expect(readCookieValues(undefined, SESSION_COOKIE)).toEqual([])
    expect(readCookieValues('', SESSION_COOKIE)).toEqual([])
    expect(readCookieValues('a=1; b=2', SESSION_COOKIE)).toEqual([])
    // A pair without `=` at all is not a pair; it used to take the whole header down.
    expect(first(`nonsense; ${SESSION_COOKIE}=${TOKEN}`)).toBe(TOKEN)
  })

  it('does not mistake a longer name for ours', () => {
    // `…molvia_session_x` can be set by a page on a neighbouring origin. Read by prefix it would
    // have been our cookie, and a stranger would have chosen the token we look up.
    expect(readCookieValues(`${SESSION_COOKIE}_x=${TOKEN}`, SESSION_COOKIE)).toEqual([])
    expect(readCookieValues(`x_${SESSION_COOKIE}=${TOKEN}`, SESSION_COOKIE)).toEqual([])
  })

  it('returns both values under one name, in the order they arrived', () => {
    // The whole point of returning a list (А2): the caller refuses two rather than picking one,
    // because the first is the one whoever set it gave the deeper path — the attacker's.
    expect(
      readCookieValues(`${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`, SESSION_COOKIE),
    ).toEqual(['first', 'second'])
  })

  it('counts an empty value as a value instead of stopping at it', () => {
    // `…session=; …session=<live>` used to answer «no cookie at all»: the empty one
    // cut the walk short and the live token behind it was never read (А3).
    expect(
      readCookieValues(`${SESSION_COOKIE}=; ${SESSION_COOKIE}=${TOKEN}`, SESSION_COOKIE),
    ).toEqual(['', TOKEN])
    expect(readCookieValues(`${SESSION_COOKIE}=`, SESSION_COOKIE)).toEqual([''])
  })

  it('leaves the value exactly as it arrived', () => {
    // Nothing here ever encodes, so decoding on the way in would be a transformation with no
    // counterpart on the way out — and two strings on the wire would become one token.
    expect(first(`${SESSION_COOKIE}=a%3Db`)).toBe('a%3Db')
    expect(first(`${SESSION_COOKIE}="quoted"`)).toBe('"quoted"')
    // `=` inside a value is legal and must not cut the value short.
    expect(first(`${SESSION_COOKIE}=a=b=c`)).toBe('a=b=c')
  })

  it('survives a header of junk', () => {
    const junk = `${'x'.repeat(10_000)}; ${SESSION_COOKIE}=${TOKEN}`
    expect(first(junk)).toBe(TOKEN)
  })
})

describe('setting the session cookie', () => {
  it('carries every flag, and `no-store` with them', () => {
    const reply = sink()
    setSessionCookie(reply, TOKEN, new Date(Date.now() + 180 * 24 * 3600 * 1000))

    const cookie = reply.headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=${TOKEN}`)
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain('Domain')
    // `Expires` would depend on the clock of the device; `Max-Age` does not.
    expect(cookie).not.toContain('Expires')
    expect(cookie).toMatch(/Max-Age=\d+/)
    expect(reply.headers.get('cache-control')).toBe('no-store')
  })

  it('counts Max-Age in whole seconds, and never below zero', () => {
    const reply = sink()
    setSessionCookie(reply, TOKEN, new Date(Date.now() + 3600_000))
    expect(reply.headers.get('set-cookie')).toMatch(/Max-Age=(3599|3600)\b/)

    const past = sink()
    setSessionCookie(past, TOKEN, new Date(Date.now() - 1_000))
    expect(past.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('refuses a value that would end the header and start another one', () => {
    // A token this server could not have minted means a caller went around the path that mints
    // one; without the guard the reply would have carried a second cookie, or a second header.
    for (const bad of ['a; Domain=evil.example', 'a\r\nSet-Cookie: x=y', 'a b', 'a"b', 'a,b', '']) {
      expect(() => {
        setSessionCookie(sink(), bad, new Date(Date.now() + 1000))
      }).toThrow(/could not have minted/)
    }
  })

  it('takes any token the session repository would take, not only a url-safe one', () => {
    // A narrower rule refuses the `=` a plain `.toString('base64')` ends with, and that would
    // make a single such call a 500 on every login (MOL-52, Р4).
    const padded = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXphYmNkZWZnaGlqa2w='
    const reply = sink()

    setSessionCookie(reply, padded, new Date(Date.now() + 1000))

    expect(reply.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=${padded}`)
  })

  it('agrees with the repository on every printable character there is', () => {
    // The two rules were two copies and drifted by four characters — `"`, `,`, `;`, `\` — which
    // cost a 500 a day after every login with a token holding one (А1). They are one rule now,
    // and this walks every code point rather than trusting that, exactly as `text.ts` does for
    // `INVISIBLE` (CLAUDE.md: «two copies drifted twice»).
    const disagreed: string[] = []
    for (let code = 0x20; code <= 0x7f; code += 1) {
      const character = String.fromCharCode(code)
      const token = character.repeat(2) + 'a'.repeat(41)
      const takenByRepository = secretOrNull(token) !== null
      let takenByCookie = true
      try {
        setSessionCookie(sink(), token, new Date(Date.now() + 1000))
      } catch {
        takenByCookie = false
      }
      if (takenByRepository !== takenByCookie) disagreed.push(character)
    }

    expect(disagreed).toEqual([])
  })

  it('and neither of them takes what a cookie value cannot hold', () => {
    // Said separately, so «they agree» cannot be satisfied by both being wrong.
    for (const bad of ['"', ',', ';', '\\', ' ']) {
      expect(secretOrNull(bad.repeat(2) + 'a'.repeat(41))).toBeNull()
    }
  })
})

describe('putting the cookie out', () => {
  it('names it with Max-Age=0 and the same flags, and never without `no-store`', () => {
    const reply = sink()
    clearSessionCookie(reply)

    const cookie = reply.headers.get('set-cookie') ?? ''
    expect(cookie).toBe(`${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`)
    expect(reply.headers.get('cache-control')).toBe('no-store')
  })
})
