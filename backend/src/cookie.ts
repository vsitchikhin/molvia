import { SESSION_COOKIE } from '@molvia/model'

/*
 * The one place a cookie is read and the one place a cookie is written (MOL-53). Beside
 * `parse.ts` and for the same reason: it is a seam the HTTP layer goes through, not a route.
 *
 * **Thirty lines instead of `@fastify/cookie`** — the owner's decision of 22.09.2026 (В-3).
 * What is needed here is one name out of one header and one line with flags known in advance:
 * no signing, no several cookies, no parsing of anybody else's. The plugin would be a
 * dependency in the API and one more link in the supply chain for that.
 */

/**
 * What a value has to look like to be put into a header. `token` is 32 bytes of `randomBytes`
 * as base64url, so it passes; the check exists because a value that did not would end the
 * response with a `;` or a newline in it — that is, another cookie, or another header.
 *
 * A plain `Error`, as the repositories do for a token this server could not have minted: it
 * means the caller went around the one path that mints one, and there is nothing to answer a
 * client with.
 */
const VALUE = /^[A-Za-z0-9_-]{1,512}$/

/**
 * Only the part of a reply this module needs, so its test does not have to build a Fastify one.
 * `FastifyReply` satisfies it structurally.
 */
export interface HeaderSink {
  header(name: string, value: string): unknown
}

/**
 * The value of one cookie out of the `Cookie:` header, or `null`.
 *
 * Three things it deliberately does **not** do:
 *
 * - **It does not decode `%`.** Nothing here ever encodes, so decoding would be a second
 *   transformation on the way in that nothing performs on the way out — and it would let two
 *   different strings on the wire become one token. A value that is not exactly what was minted
 *   simply matches no hash, which is the answer that belongs here.
 * - **It does not strip quotes.** RFC 6265 allows a quoted value; we never write one, and a
 *   client that adds quotes is not holding our token.
 * - **It compares the name whole.** Split first, compare after — otherwise
 *   `molvia_session_x=…` is read as `molvia_session`, which is a cookie a page on a neighbouring
 *   origin could set.
 *
 * Duplicates take the first: browsers send the more specific path first, and there is no answer
 * that is more right than «the one the browser prefers».
 */
export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null

  for (const pair of header.split(';')) {
    const at = pair.indexOf('=')
    if (at === -1) continue
    if (pair.slice(0, at).trim() !== name) continue

    const value = pair.slice(at + 1).trim()
    return value === '' ? null : value
  }
  return null
}

/**
 * The flags, in one place, with the reason each one is here.
 *
 * - `HttpOnly` — the whole point: a script cannot read it, so an XSS does not carry the account
 *   away. It is also what keeps ITP off it: Safari caps what a *script* writes at seven days,
 *   not what a server sets.
 * - `Secure` — always, with no branch for the environment. Browsers treat `http://127.0.0.1` as
 *   a trustworthy origin, so development is unaffected; the one place it does bite is
 *   `PWA_EXPOSE=1 make dev` over plain http to a phone, and there the answer is `make certs`,
 *   the same as for the camera. A conditional `Secure` would be a branch saying «here it is not
 *   needed», and that branch eventually reaches production.
 * - `SameSite=Lax` (owner's decision, В-1) — every handle that writes is `POST`, `PUT` or
 *   `DELETE`, and `Lax` withholds the cookie from all of them when another site started the
 *   request. `Strict` would refuse it on the one navigation the epic is built around as well —
 *   the person coming back from the bot.
 * - `Path=/`, no `Domain` — the browser sees `/api/…`, both Caddy and the Vite proxy strip the
 *   prefix before the server; without `Domain` the cookie belongs to exactly the host that set
 *   it.
 */
const FLAGS = 'Path=/; HttpOnly; Secure; SameSite=Lax'

/**
 * `Max-Age` and not `Expires`: a relative number does not depend on the clock of the device.
 * Persistent and not a session cookie — closing the browser must not be a way out.
 */
function maxAgeSeconds(expiresAt: Date): number {
  return Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000))
}

/**
 * Sets the session cookie, and `no-store` with it — never one without the other.
 *
 * That pairing is the whole of «a cookie is not handed out by a reply that can be cached», and
 * it holds because there is one function rather than because somebody remembers. It matters
 * beyond the login: the sliding term (MOL-53, Р-2) re-sets the cookie on whatever handle the
 * request happened to be, so `/advice` or `/trips/current` becomes `no-store` for that reply.
 */
export function setSessionCookie(reply: HeaderSink, token: string, expiresAt: Date): void {
  if (!VALUE.test(token)) {
    throw new Error('a token this server could not have minted reached the cookie')
  }

  reply.header('cache-control', 'no-store')
  reply.header(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; Max-Age=${String(maxAgeSeconds(expiresAt))}; ${FLAGS}`,
  )
}

/**
 * Puts out a cookie the server has just refused (Р-4, owner's decision В-5). A dead secret
 * stops riding on every request and stops sitting on the disk.
 *
 * Called only where **this** server said «no such session» — a 401 from Caddy, from a gateway
 * or from a shop's captive portal never reaches this code, so nothing outside can talk a
 * browser into dropping a live session.
 */
export function clearSessionCookie(reply: HeaderSink): void {
  reply.header('cache-control', 'no-store')
  reply.header('set-cookie', `${SESSION_COOKIE}=; Max-Age=0; ${FLAGS}`)
}
