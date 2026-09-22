import { describe, expect, it } from 'vitest'
import { SESSION_COOKIE } from '@molvia/model'
import { clearSessionCookie, readCookie, setSessionCookie } from './cookie'

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

describe('reading one cookie out of the header', () => {
  it('finds it among others, whatever the spacing', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=${TOKEN}; b=2`, SESSION_COOKIE)).toBe(TOKEN)
    expect(readCookie(`a=1;${SESSION_COOKIE}=${TOKEN}`, SESSION_COOKIE)).toBe(TOKEN)
    expect(readCookie(`  ${SESSION_COOKIE}  =  ${TOKEN}  `, SESSION_COOKIE)).toBe(TOKEN)
  })

  it('answers nothing when there is no header, no such name, or no value', () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull()
    expect(readCookie('', SESSION_COOKIE)).toBeNull()
    expect(readCookie('a=1; b=2', SESSION_COOKIE)).toBeNull()
    expect(readCookie(`${SESSION_COOKIE}=`, SESSION_COOKIE)).toBeNull()
    // A pair without `=` at all is not a pair; it used to take the whole header down.
    expect(readCookie(`nonsense; ${SESSION_COOKIE}=${TOKEN}`, SESSION_COOKIE)).toBe(TOKEN)
  })

  it('does not mistake a longer name for ours', () => {
    // `molvia_session_x` can be set by a page on a neighbouring origin. Read by prefix it would
    // have been our cookie, and a stranger would have chosen the token we look up.
    expect(readCookie(`${SESSION_COOKIE}_x=${TOKEN}`, SESSION_COOKIE)).toBeNull()
    expect(readCookie(`x_${SESSION_COOKIE}=${TOKEN}`, SESSION_COOKIE)).toBeNull()
  })

  it('takes the first of two values under one name', () => {
    // Browsers send the more specific path first, and there is no answer more right than the
    // one the browser itself prefers.
    expect(readCookie(`${SESSION_COOKIE}=first; ${SESSION_COOKIE}=second`, SESSION_COOKIE)).toBe(
      'first',
    )
  })

  it('leaves the value exactly as it arrived', () => {
    // Nothing here ever encodes, so decoding on the way in would be a transformation with no
    // counterpart on the way out — and two strings on the wire would become one token.
    expect(readCookie(`${SESSION_COOKIE}=a%3Db`, SESSION_COOKIE)).toBe('a%3Db')
    expect(readCookie(`${SESSION_COOKIE}="quoted"`, SESSION_COOKIE)).toBe('"quoted"')
    // `=` inside a value is legal and must not cut the value short.
    expect(readCookie(`${SESSION_COOKIE}=a=b=c`, SESSION_COOKIE)).toBe('a=b=c')
  })

  it('survives a header of junk', () => {
    const junk = `${'x'.repeat(10_000)}; ${SESSION_COOKIE}=${TOKEN}`
    expect(readCookie(junk, SESSION_COOKIE)).toBe(TOKEN)
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
    for (const bad of ['a; Domain=evil.example', 'a\r\nSet-Cookie: x=y', 'a b', '']) {
      expect(() => {
        setSessionCookie(sink(), bad, new Date(Date.now() + 1000))
      }).toThrow(/could not have minted/)
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
