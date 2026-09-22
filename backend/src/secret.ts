/**
 * What a secret this server mints may look like — **one rule, in one place** (MOL-53,
 * adversarial А1).
 *
 * There were two, and they drifted by four characters. `db/digest.ts` accepted every printable
 * ASCII byte; `cookie.ts` accepted base64url. A session whose token held `"`, `,`, `;` or `\`
 * was therefore written and read perfectly well, and then ended one of three ways: a `500` on
 * the first request after a day, when the term came due and the cookie refused the value it had
 * been carrying all along; the same `500` **flickering**, because the row was already extended
 * before the throw, so the next request answered `200` and the failure came back a day later;
 * or — for `;`, which is the header's own separator — a row in `sessions` that no request could
 * ever open. That is the shape `CLAUDE.md` names about `INVISIBLE` in `text.ts`: «two copies
 * drifted twice». The answer there was one list and a test that walks every code point, and it
 * is the answer here.
 *
 * **The rule is RFC 6265's `cookie-octet`**, because the only thing either secret ever travels
 * in is a cookie — the session token here, the login request's secret in MOL-54. Everything
 * printable except the four characters a cookie value cannot hold: `"`, `,`, `;`, `\` (and
 * space and DEL, which are outside the range anyway).
 *
 * **It does not bring back the trap of MOL-52, Р4.** That one was a rule narrowed to base64url,
 * which refused the `=` that a plain `.toString('base64')` ends with — so a single such call in
 * MOL-53 would have made every login a 500. `cookie-octet` holds `+`, `/` and `=`, so every
 * base64 and base64url string still passes; what it drops is only what the wire itself cannot
 * carry.
 *
 * **The floor of 32 characters is not a security rule** (how long a token is belongs to whoever
 * mints one): it is what makes «this could not have come from us» decidable at all.
 *
 * Here rather than in `db/` because it is not a fact about the database, and not in `cookie.ts`
 * because the repositories must not import the HTTP seam. Beside `parse.ts`, which is the other
 * thing every request passes through.
 */
const SECRET = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{32,512}$/

/** The secret as it reached us, or `null` when this server could not have minted it. */
export function secretOrNull(value: string): string | null {
  return SECRET.test(value) ? value : null
}
