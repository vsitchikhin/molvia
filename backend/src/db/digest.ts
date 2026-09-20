import { createHash } from 'node:crypto'

/**
 * What a secret looks like in the database, and the only shape either digest column holds
 * (MOL-52, Р-5).
 *
 * **sha256, no salt, no key-stretching — and that is the right tool, not a shortcut.** A slow
 * hash exists to make a dictionary expensive; the values passed here are 32 bytes of
 * `randomBytes`, so there is no dictionary and nothing to slow down, while the cost would be
 * paid on **every** request to the API. A salt is impossible for a different reason: the hash
 * has to be deterministic, or the unique index it is looked up by could not find it.
 *
 * There is no comparison in the code either — a session is found by its hash through that
 * index — so no timing oracle: an attacker would have to know the token to produce the hash
 * whose lookup they wanted to time.
 *
 * Lives here rather than in `packages/model` because the domain imports nothing but zod: a
 * rule that needs `node:crypto` is not a rule of the domain.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * What a secret has to look like to reach a digest column.
 *
 * It exists because `sha256Hex` is **not** injective over arbitrary JavaScript strings: a lone
 * surrogate becomes U+FFFD on the way to UTF-8, so two different tokens would share a digest
 * and open one session (MOL-52, adversarial А6). Rather than change how the hash is taken —
 * hex is what a person compares against in `psql` — what reaches it has to be a string that
 * survives the trip to UTF-8 unchanged.
 *
 * **Printable ASCII, and deliberately not «base64url or hex».** That narrower rule was the
 * first version, and it was a trap: 32 bytes as plain `base64` end in `=`, which it refused —
 * so a single `.toString('base64')` in MOL-53, where the minting actually happens, would have
 * made **every** login a 500, and no test here would have shown it, because the tests all mint
 * correctly (adversarial Р4). The property this guard is for is the round trip, so the round
 * trip is what it checks; the encoding is the minter's business.
 *
 * The floor of 32 characters is not a security rule (how long a token is belongs to MOL-53):
 * it is what makes «this could not have come from us» decidable here at all.
 */
const SECRET = /^[\x21-\x7E]{32,512}$/

/** The secret as it reached us, or `null` when this server could not have minted it. */
export function secretOrNull(value: string): string | null {
  return SECRET.test(value) ? value : null
}
