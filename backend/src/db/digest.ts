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
 * Every secret this server mints is `randomBytes(32)` in base64url or hex, so this is the
 * shape both of them have — and the shape anything reaching a digest column has to survive.
 *
 * It exists because `sha256Hex` is **not** injective over arbitrary JavaScript strings: a lone
 * surrogate becomes U+FFFD on the way to UTF-8, so `'\uD800'` and `'\uDFFF'` share a digest,
 * and two different tokens would open one session (MOL-52, adversarial А6). Rather than change
 * how the hash is taken — hex is what a person compares against in `psql` — the values that
 * reach it are held to the alphabet they are actually drawn from. Over that alphabet the
 * digest is an identity, which is what the repositories promise.
 *
 * The floor of 32 characters is not a security rule (the length of what is minted is MOL-53's
 * business): it is what makes «this could not have come from us» decidable here.
 */
const SECRET = /^[A-Za-z0-9_-]{32,512}$/

/** The secret as it reached us, or `null` when this server could not have minted it. */
export function secretOrNull(value: string): string | null {
  return SECRET.test(value) ? value : null
}
