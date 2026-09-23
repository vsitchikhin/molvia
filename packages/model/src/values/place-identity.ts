/**
 * When two spellings name one place, as the database decides it.
 *
 * The unique index over `places` computes this in SQL (`backend/src/db/schema.ts`,
 * `placeIdentity`), and that is the authority: it is what makes «Ереван Сити» typed twice one
 * row. This is its twin in TypeScript, for the one caller that has to know the same thing
 * before any request is made — the screen that asks whether «Дописать в тот поход» would move
 * prices into *another* shop. Comparing the names as typed promised that damage for a trailing
 * space (MOL-25, В3).
 *
 * The two are held equal by an integration test that runs a corpus through Postgres and through
 * this function, for the reason `INVISIBLE` and `secret.ts` are held that way: a copy that
 * drifts from its twin is exactly the bug it was written to prevent.
 *
 * **It is not the search key's `nameIdentity`.** That one decides whether an *item* is a
 * duplicate and folds Armenian spellings on top of NFC; this one has to match a database index
 * character for character, so it is NFKC, drops variation selectors and trims the same list of
 * blanks — and, deliberately, does **not** collapse runs of spaces inside the name: `btrim`
 * touches the ends only, so «Ереван  Сити» with two spaces is a different place to the server
 * and must read as one here too.
 */

/**
 * What `btrim` is given in the index: the blanks a name may be padded with, invisible ones
 * included. Alternatives rather than a character class: a class holding a zero-width joiner is
 * read as one that can join what stands beside it, which is a real trap and a lint error here.
 */
const BLANKS = ['\u0020', '\t', '\r', '\n', '\u00A0', '\u200B', '\u200C', '\u200D', '\uFEFF'].join(
  '|',
)

/** Selectors choose how a character is drawn, never which character it is: «Кафе ☕» is one café. */
const SELECTORS = String.raw`\uFE00-\uFE0F\u{E0100}-\u{E01EF}`

const DRAWN = new RegExp(`[${SELECTORS}]`, 'gu')
const EDGES = new RegExp(`^(?:${BLANKS})+|(?:${BLANKS})+$`, 'gu')

export function placeNameIdentity(name: string): string {
  return name.normalize('NFKC').replace(DRAWN, '').toLowerCase().replace(EDGES, '')
}

/** Whether two names would reach the same row of `places`. */
export function isSamePlaceName(a: string, b: string): boolean {
  return placeNameIdentity(a) === placeNameIdentity(b)
}
