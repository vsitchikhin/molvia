import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * The bot as it ships, not as the tests run it (MOL-142). node-fetch, under grammY, takes a signal
 * only if its constructor is called `AbortSignal`, and grammY hands it abort-controller's on every
 * call. The bot's first use of the global `AbortSignal` made esbuild rename that class
 * `AbortSignal2`, and in production every call to Telegram failed — while every test passed,
 * since none of them runs the bundle. `keepNames` in `bin/bundle.mjs` is what keeps the name.
 */
describe('the bundled bot', () => {
  it('keeps the name of a class esbuild renamed', () => {
    execFileSync(process.execPath, [`${root}bin/bundle.mjs`, 'bot'], { stdio: 'ignore' })
    const bundle = readFileSync(`${root}bot/dist/index.js`, 'utf8')

    const renamed =
      /\bAbortSignal(\d+) = class\b[^{]*\{\s*static \{\s*__name\(this, "(\w+)"\)/.exec(bundle)
    // Either the class kept its name outright, or it was renamed and carries its own back.
    if (/\bAbortSignal\d+ = class\b/.test(bundle)) expect(renamed?.[2]).toBe('AbortSignal')
    else expect(bundle).toMatch(/\bAbortSignal = class\b|\bclass AbortSignal\b/)
  })
})
