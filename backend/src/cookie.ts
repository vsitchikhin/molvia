import { LOGIN_COOKIE, SESSION_COOKIE } from '@molvia/model'
import { secretOrNull } from '@/secret'

/*
 * The one place a cookie is read and the one place a cookie is written (MOL-53). Beside
 * `parse.ts` and for the same reason: it is a seam the HTTP layer goes through, not a route.
 *
 * **Thirty lines instead of `@fastify/cookie`** — the owner's decision of 22.09.2026 (В-3).
 * What is needed here is one name out of one header and one line with flags known in advance:
 * no signing, no several cookies, no parsing of anybody else's. The plugin would be a
 * dependency in the API and one more link in the supply chain for that.
 */

/*
 * What a value may look like is **not decided here**: `@/secret` holds that rule, and every
 * caller — this module and both repositories — asks the same one (MOL-53, А1). Two copies of it
 * drifted by four characters and cost a 500 a day after every login with a token holding one of
 * them; the reasoning is written down where the rule now lives.
 */

/**
 * Only the part of a reply this module needs, so its test does not have to build a Fastify one.
 * `FastifyReply` satisfies it structurally.
 */
export interface HeaderSink {
  header(name: string, value: string): unknown
}

/**
 * **Every** value the `Cookie:` header carries under one name, in the order it sent them.
 *
 * It returns a list rather than the first match, and that is the whole of the fix for a session
 * fixation this code was open to (MOL-53, А2). A browser sends the more specific path first
 * (RFC 6265 §5.4), so anything able to set a cookie on this host — a sibling app on another port
 * in development, where the port is not part of «site»; a subdomain or an XSS later — could put
 * `__Host-molvia_session` with a longer `Path` in front of the real one. Reading the first match meant
 * the server answered **as the attacker**, and everything the person entered afterwards went
 * into that account. The caller now refuses when there is more than one, because «which of these
 * is ours» has no honest answer here.
 *
 * An empty value is a value: it counts towards that number and does not cut the walk short.
 * Before, `…session=; …session=<live>` returned nothing at all and the live token in
 * second place was never read (А3).
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
 *   `__Host-molvia_session_x=…` is read as `__Host-molvia_session`, which is a cookie a page on a neighbouring
 *   origin could set.
 */
export function readCookieValues(header: string | undefined, name: string): string[] {
  if (header === undefined) return []

  const values: string[] = []
  for (const pair of header.split(';')) {
    const at = pair.indexOf('=')
    if (at === -1) continue
    if (pair.slice(0, at).trim() !== name) continue

    values.push(pair.slice(at + 1).trim())
  }
  return values
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

/** The name the development seam remembers a browser's account by; see `setDevAccountCookie`. */
export const DEV_ACCOUNT_COOKIE = '__Host-molvia_dev_account'

/** A year: long enough that no working day of development ever reaches the end of it. */
const DEV_ACCOUNT_MAX_AGE = 365 * 24 * 3600

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
  if (secretOrNull(token) === null) {
    throw new Error('a token this server could not have minted reached the cookie')
  }

  reply.header('cache-control', 'no-store')
  reply.header(
    'set-cookie',
    `${SESSION_COOKIE}=${token}; Max-Age=${String(maxAgeSeconds(expiresAt))}; ${FLAGS}`,
  )
}

/**
 * The Telegram account the development seam gave this browser, remembered in a cookie of its
 * own (MOL-53, owner's decision 22.09.2026: «the owner of an account must not change»).
 *
 * **Why a second cookie and not a wider seam.** The seam cannot be asked to sign in as somebody
 * named — that is the door the epic closes. But it minted a fresh Telegram id on every call, so
 * a session that ran out or was revoked came back as a **different owner**, and the trip queue,
 * the recent items and the verdict drafts — all filed under the owner's id — were left on the
 * device out of reach. What this cookie does is stand in for Telegram: it is the thing the
 * browser comes back by, so `signIn` finds the same owner, exactly as it will in MOL-54.
 *
 * Longer-lived than the session on purpose: an account outlives any one way into it. Clearing
 * the browser's cookies is the one thing that still makes a new person, and that is honest —
 * it is the development counterpart of losing the Telegram account itself.
 *
 * Lives here because this is the one module that writes cookies (Р-6), and it is used by the
 * seam alone, which is not in the production bundle.
 */
export function setDevAccountCookie(reply: HeaderSink, telegramUserId: number): void {
  reply.header('cache-control', 'no-store')
  reply.header(
    'set-cookie',
    `${DEV_ACCOUNT_COOKIE}=${String(telegramUserId)}; Max-Age=${String(DEV_ACCOUNT_MAX_AGE)}; ${FLAGS}`,
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

/** No clearing on poll: an old response must not erase a newer request's secret. */
export function setLoginCookie(reply: HeaderSink, secret: string, expiresAt: Date): void {
  if (secretOrNull(secret) === null) throw new Error('invalid login cookie secret')
  reply.header('cache-control', 'no-store')
  reply.header(
    'set-cookie',
    `${LOGIN_COOKIE}=${secret}; Max-Age=${String(maxAgeSeconds(expiresAt))}; ${FLAGS}`,
  )
}
