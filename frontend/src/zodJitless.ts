import { config } from 'zod'

/**
 * Zod without its compiled parsers, before any module of the app parses (MOL-363). Zod 4 asks once
 * whether it may compile — `Function('')` in a `try` — and under the page's policy, which allows no
 * `eval`, the answer is no and the browser reports a violation for the question itself. Told it is
 * jitless, Zod parses as it would after that «no» and never asks.
 */
config({ jitless: true })
