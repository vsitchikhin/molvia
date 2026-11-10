import { DomainError, ERROR } from '@molvia/model'
import type { FastifyRequest } from 'fastify'

/**
 * Whether the browser says the request was started by another site's page (`Sec-Fetch-Site`).
 *
 * The browser sets the header and the page that triggers the request cannot write it, so it is the
 * right thing to read. `same-origin` is the PWA and its proxy; `none` is a navigation no page started —
 * the address bar, and a link another app handed the browser too (`refuseOutsideTheApp`); absent is
 * `curl`, the tests, the bot — none of which carries anybody's cookie but its own. Every browser of
 * the build's floor sends it (Safari learned it in 16.4, the floor itself).
 */
export function fromAnotherSite(request: FastifyRequest): boolean {
  const site = request.headers['sec-fetch-site']
  return site !== undefined && site !== 'same-origin' && site !== 'none'
}

/**
 * Nothing another site's page starts reaches what stands behind this hook (MOL-53, А5): the seam that
 * hands out a session. `SameSite=Lax` governs whether a cookie is **sent**, not whether one may be
 * **set**, and a cross-site `fetch(url, {method: 'POST', mode: 'no-cors'})` with no body needs no
 * preflight — any page could sign a developer's browser in as a brand-new owner, writing over the
 * session they worked with. **404, through the registry**: to a caller with no business here the
 * address does not exist.
 */
export function refuseAnotherSite(request: FastifyRequest): Promise<void> {
  if (fromAnotherSite(request)) throw new DomainError(ERROR.NOT_FOUND)
  return Promise.resolve()
}

/**
 * Only the app reaches a route with a session: another site's page never, and a navigation never
 * (audit MOL-287 Ф-13, MOL-368, owner's В-1 «а»).
 *
 * `Lax` sends the cookie on a top-level `GET` from any site, so a link on a foreign page was a request
 * of the person's that wrote — the visit of gate 0.3 (`GET /advice`), a read receipt «heard» so the bot
 * kept «Чек разобран» back (`GET /receipts?shown=1`), a removal made final before its «Вернуть» ran out
 * (`GET /exchanges`, `GET /incomes`). **A link another app hands the browser is `none`** — a chat, a
 * letter, Telegram Desktop (adversarial А1: Chrome sends `none`, `navigate`, `document`, measured on
 * 10.11.2026) — so `none` is no proof of the person's own act either. The app reaches the API by
 * `fetch` alone — the copy of one's data too — never by a navigation, so `Sec-Fetch-Mode: navigate`
 * is refused whatever the site. The door is closed whole rather than each write that may stand behind
 * a `GET` one day.
 *
 * **404, never the 401 of a missing session**, which puts the cookie out — a foreign link would sign the
 * person out. And before the session is looked up, so neither its term nor `last_seen_at` moves.
 */
export function refuseOutsideTheApp(request: FastifyRequest): Promise<void> {
  if (fromAnotherSite(request) || request.headers['sec-fetch-mode'] === 'navigate') {
    throw new DomainError(ERROR.NOT_FOUND)
  }
  return Promise.resolve()
}
