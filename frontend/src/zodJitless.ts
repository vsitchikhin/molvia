import { config } from 'zod'

/**
 * Zod without its compiled parsers, before any schema is built (MOL-363): the model's are built as its
 * modules load, and `@/catchers` pulls them in first — so this is imported before it, not merely before
 * the first parse. Zod 4 asks whether it may compile as it builds an object schema — `Function('')` in
 * a `try` — and under the page's policy, which allows no `eval`, the answer is no and the browser
 * reports a violation for the question itself. Told it is jitless, Zod parses as it would after that
 * «no» and never asks.
 */
config({ jitless: true })
