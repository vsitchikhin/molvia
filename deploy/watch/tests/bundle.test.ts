import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('..', import.meta.url))

/**
 * The Worker as it ships (MOL-221): the one file `deploy.sh` uploads. Cloudflare takes it whole, so
 * it must import nothing — an alias left unresolved is an upload refused only at the rollout — and
 * hand Cloudflare the handler its cron calls. Node stays out by the source's types, `tsconfig.json`.
 */
describe('the bundled Worker', () => {
  it('is one module that imports nothing and exports the scheduled handler', async () => {
    execFileSync('npm', ['run', 'bundle'], { cwd: here, stdio: 'ignore' })
    const file = `${here}dist/worker.js`
    const bundle = readFileSync(file, 'utf8')
    expect(bundle).not.toMatch(/^\s*import\b|\brequire\(/m)

    const worker = (await import(file)) as { default: { scheduled?: unknown } }
    expect(typeof worker.default.scheduled).toBe('function')
  })
})
