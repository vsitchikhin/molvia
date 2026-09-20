import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The promise MOL-53 makes about its login seam, kept one task early and kept by the artifact
 * rather than by intent: the development path to an identity **cannot** be switched on in
 * production, because it is not in the production build at all (MOL-52, Р-14).
 *
 * Why this is a test and not a comment. `server.ts` guards the seam with
 * `process.env.NODE_ENV !== 'production'` and `bin/bundle.mjs` replaces that expression with a
 * literal, so esbuild folds the condition, drops the branch and tree-shakes the module behind
 * it. Every step there is quiet when it fails: an `import process from 'node:process'` added to
 * `server.ts` would bind the name and stop the substitution, a refactor that hides the guard
 * behind a variable would stop the folding, and in both cases the code still reads exactly as
 * it does now. Nothing would be red — the route would simply be there, in production, wide open
 * and writing rows for anyone who found it.
 *
 * Under the integration project rather than the unit one: it runs a real build, which takes
 * seconds a fast loop should not pay.
 */
const root = fileURLToPath(new URL('../..', import.meta.url))

describe('the production bundle', () => {
  it('does not contain the development identity seam', () => {
    execFileSync('node', ['bin/bundle.mjs', 'backend'], { cwd: root, stdio: 'pipe' })

    const bundle = readFileSync(`${root}backend/dist/index.js`, 'utf8')

    // The address, and the module's own name for good measure: if either survives, the branch
    // did not fold and the seam shipped.
    expect(bundle).not.toContain('/dev/actors')
    expect(bundle).not.toContain('devActorRoute')
    // A guard against the test passing for the wrong reason — an empty or half-built file
    // contains no `/dev/actors` either.
    expect(bundle).toContain('/actors/me')
  })
})
