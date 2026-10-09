import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { broadcasts } from '@/db/schema'
import { connectDrizzle, testDatabaseUrl } from './db'
import { clearAll, insertActor } from './fixtures'

/**
 * The message about a leak is only worth anything if it can be sent where it is needed: from the
 * production image, one bundled file per entry and no `node_modules`, with the text on standard input
 * (MOL-237). So the built file is run here, as the image would run it, against the test database.
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const { db, close } = connectDrizzle()
beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

const TEXT = 'Molvia: тест.\n\nMolvia: a test.\n'

function notify(input: string, ...args: string[]) {
  return spawnSync('node', [`${root}backend/dist/notify.js`, ...args], {
    encoding: 'utf8',
    input,
    env: {
      PATH: process.env.PATH,
      DATABASE_URL: testDatabaseUrl(),
      // The bundle is built as production, and production refuses to start without these.
      TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
      BOT_API_SECRET: randomBytes(32).toString('base64url'),
    },
  })
}

describe('dist/notify.js', () => {
  it('сухой прогон, очередь и ход — из одного собранного файла', async () => {
    await insertActor(db, { country: 'AM' })
    await insertActor(db, { country: 'GE', botBlockedAt: new Date() })

    const dry = notify(TEXT)
    expect(dry.status).toBe(0)
    expect(dry.stdout).toContain('Molvia: a test.')
    expect(dry.stdout).toContain('in all: 1 get it, 1 skipped')
    expect(dry.stdout).toContain('dry run: nothing queued')
    expect(await db.select().from(broadcasts)).toEqual([])

    const sent = notify(TEXT, '--yes')
    expect(sent.status).toBe(0)
    expect(sent.stdout).toMatch(/queued #\d+ for 1\./)
    const [queued] = await db.select().from(broadcasts)
    expect(queued?.text).toBe(TEXT.trim())

    const status = notify('', '--status')
    expect(status.status).toBe(0)
    expect(status.stdout).toMatch(/to everybody, queued .*: going/)

    const wrong = notify(TEXT, '--force')
    expect(wrong.status).toBe(2)
    expect(wrong.stdout).toContain('usage: notify')
  })
})

describe('dist/notify.js — вход', () => {
  // Adversarial А4: over `ssh … exec -T` with the file forgotten, the input is a pipe that never ends.
  it('открытая труба без сообщения — через пару секунд подсказка и код 2, а не молчание', async () => {
    const child = spawn('node', [`${root}backend/dist/notify.js`], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: testDatabaseUrl(),
        TELEGRAM_BOT_USERNAME: 'molvia_test_bot',
        BOT_API_SECRET: randomBytes(32).toString('base64url'),
      },
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
    const started = Date.now()
    expect(await exited).toBe(2)
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(output).toContain('the message comes on standard input')
    child.stdin.end()
  }, 20_000)
})

describe('bin/notify.sh', () => {
  // Adversarial А3: the header's first form, the file alone.
  it('файл без стран — сухой прогон всем; файл и --yes — --yes не страны', async () => {
    await insertActor(db)
    const file = join(mkdtempSync(join(tmpdir(), 'notify-')), 'notice.txt')
    writeFileSync(file, TEXT)
    // the test database, not the copy's: `.env` never overrides what the environment already says
    const env = { ...process.env, DATABASE_URL: testDatabaseUrl() }
    const alone = spawnSync(`${root}bin/notify.sh`, [file], { cwd: root, encoding: 'utf8', env })
    expect(alone.status).toBe(0)
    expect(alone.stdout).toContain('to everybody:')
    expect(alone.stdout).toContain('in all: 1 get it')
    expect(alone.stdout).toContain('dry run: nothing queued')
    const owner = spawnSync(`${root}bin/notify.sh`, [file, '--owner'], {
      cwd: root,
      encoding: 'utf8',
      env,
    })
    expect(owner.stdout).not.toContain('usage: notify')
  }, 60_000)
})

describe('make notify', () => {
  // Adversarial О-6 and П-3 of `forget`: a value must not bring its own `--yes`. Each of these is one
  // argument, a file that is not there — refused before anything reads the database.
  it.each(['x.txt --yes', 'x.txt" --yes "--yes', '1" ; echo PWNED "'])(
    'FILE=%s — одно имя файла, и его нет',
    (value) => {
      const run = spawnSync('make', ['--no-print-directory', 'notify', `FILE=${value}`], {
        cwd: root,
        encoding: 'utf8',
      })
      expect(run.status).not.toBe(0)
      // the whole value is named as the file, and nothing of it ran
      expect(run.stdout).toContain(`cannot read the message file: ${value}`)
      expect(run.stdout).not.toMatch(/^PWNED/m)
    },
  )

  // Adversarial Р2-А2: COUNTRY is glued to `--country=`, so no value of it is ever a flag.
  it.each(['--yes', '--owner', '--status'])(
    'COUNTRY=%s — не флаг: отказ, ничего не поставлено',
    async (country) => {
      await insertActor(db)
      const file = join(mkdtempSync(join(tmpdir(), 'notify-')), 'notice.txt')
      writeFileSync(file, TEXT)
      const run = spawnSync(
        'make',
        ['--no-print-directory', 'notify', `FILE=${file}`, `COUNTRY=${country}`],
        { cwd: root, encoding: 'utf8', env: { ...process.env, DATABASE_URL: testDatabaseUrl() } },
      )
      expect(run.status).not.toBe(0)
      expect(run.stdout).toContain('usage: notify')
      expect(await db.select().from(broadcasts)).toEqual([])
    },
    60_000,
  )

  // `-n` prints the recipe and runs nothing.
  function recipe(args: string[], env: NodeJS.ProcessEnv = process.env): string {
    return spawnSync('make', ['-n', '--no-print-directory', 'notify', ...args], {
      cwd: root,
      encoding: 'utf8',
      env,
    }).stdout
  }

  it.each([['YES=0'], ['YES=no'], ['YES=true'], ['YES=']])('%s — сухой прогон', (yes) => {
    expect(recipe(['FILE=notice.txt', yes])).not.toContain('--yes')
  })

  it('YES, OWNER, STATUS и CANCEL — только набранные в этой команде', () => {
    expect(recipe(['FILE=notice.txt', 'YES=1', 'OWNER=1'])).toMatch(/--owner .*--yes/)
    expect(recipe(['STATUS=1'])).toContain('--status')
    expect(recipe(['CANCEL=1'])).toContain('--cancel')
    const inherited = recipe(['FILE=notice.txt'], {
      ...process.env,
      YES: '1',
      OWNER: '1',
      STATUS: '1',
      CANCEL: '1',
      COUNTRY: 'AM',
    })
    expect(inherited).not.toMatch(/--yes|--owner|--status|--cancel/)
    expect(inherited).toContain('unset COUNTRY')
  })
})
