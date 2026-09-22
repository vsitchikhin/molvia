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
 * **What may reach this function lives in `@/secret`**, and every caller checks it there
 * (MOL-53, А1).
 *
 * That guard exists because `sha256Hex` is **not** injective over arbitrary JavaScript strings:
 * a lone surrogate becomes U+FFFD on the way to UTF-8, so two different tokens would share a
 * digest and open one session (MOL-52, А6). The rule used to live here, beside the hash — and a
 * second, wider copy of it lived in `cookie.ts`. The two drifted by four characters, and the
 * price was a 500 a day after every login with a token holding one of them. One rule, one home.
 */
