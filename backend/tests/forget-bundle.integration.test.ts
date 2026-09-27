import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { connectDrizzle, testDatabaseUrl } from './db'
import { insertActor, telegramId } from './fixtures'

/**
 * The owner's fallback for erasure is only worth anything if it runs where it is needed: in the
 * production image, which holds one bundled file per entry and no `node_modules` (MOL-58). So the
 * built file is run here, as the image would run it, against the test database.
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const { db, close } = connectDrizzle()
afterAll(close)

function forget(...args: string[]) {
  return spawnSync('node', [`${root}backend/dist/forget.js`, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: testDatabaseUrl(),
      // The bundle is built as production, and production refuses to start without these.
      TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
      BOT_API_SECRET: randomBytes(32).toString('base64url'),
    },
  })
}

describe('dist/forget.js', () => {
  it('is built beside the server and answers from the bundle alone', async () => {
    execFileSync('node', ['bin/bundle.mjs', 'backend'], { cwd: root, stdio: 'pipe' })
    const tg = telegramId()
    await insertActor(db, { telegramUserId: tg })

    const dry = forget(String(tg))

    expect(dry.status).toBe(0)
    expect(dry.stdout).toContain('owner found')
    expect(dry.stdout).toContain('dry run: nothing changed')

    const wrong = forget('not-an-id')
    expect(wrong.status).toBe(2)
    expect(wrong.stdout).toContain('usage: forget')
  })
})

// Adversarial О-6 and П-3: the value of TG must not be able to bring its own `--yes`, quoted or
// not. Every value here is refused before the database — none of them is a Telegram id alone.
describe('make forget', () => {
  it.each(['184467331 --yes', '184467331" --yes "--yes', '1" ; echo PWNED "'])(
    'TG=%s is one argument, and so a refusal',
    (value) => {
      const run = spawnSync('make', ['--no-print-directory', 'forget', `TG=${value}`], {
        cwd: root,
        encoding: 'utf8',
      })
      expect(run.status).not.toBe(0)
      expect(run.stdout).toContain('usage: forget')
      expect(run.stdout).not.toContain('PWNED')
    },
  )

  // MOL-112, adversarial Е: only YES=1 typed on the command line erases. `-n` prints the recipe
  // and runs nothing.
  it.each([['YES=0'], ['YES=no'], ['YES=false'], ['YES=']])('%s is a dry run', (yes) => {
    const run = spawnSync('make', ['-n', '--no-print-directory', 'forget', 'TG=184467331', yes], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(run.stdout).toContain('forget-actor.sh')
    expect(run.stdout).not.toContain('--yes')
  })

  it('YES=1 erases, and a YES left in the environment does not', () => {
    const typed = spawnSync(
      'make',
      ['-n', '--no-print-directory', 'forget', 'TG=184467331', 'YES=1'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
    const inherited = spawnSync('make', ['-n', '--no-print-directory', 'forget', 'TG=184467331'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, YES: '1' },
    })
    expect(typed.stdout).toContain('--yes')
    expect(inherited.stdout).not.toContain('--yes')
  })
})
