/**
 * `deploy/ff.sh` turning an «фф» on and off in production's `.env.prod` (MOL-382, adversarial А5 and А6).
 *
 * The script runs as it is, in a directory of its own beside a copy of `docker-compose.prod.yml` and an
 * `.env.prod` as production has it — `.env.prod.example` without its фф, made before MOL-382 — and asks the
 * real `docker compose` what it reads, as it does on the machine; nothing is started. No database: it sits
 * here because a script of the deploy is tested by running it.
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Production's `.env.prod`: the example's lines but its фф, an empty value a placeholder. */
const PRODUCTION = readFileSync(join(REPO, '.env.prod.example'), 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('FF_'))
  .map((line) => (/^[A-Z_0-9]+=$/.test(line) ? `${line}x` : line))
  .join('\n')

/** A machine's directory: the compose file and `env` as its `.env.prod`. */
function machine(env: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'molvia-ff-'))
  made.push(dir)
  copyFileSync(join(REPO, 'docker-compose.prod.yml'), join(dir, 'docker-compose.prod.yml'))
  copyFileSync(join(REPO, 'deploy/ff.sh'), join(dir, 'ff.sh'))
  writeFileSync(join(dir, '.env.prod'), env)
  chmodSync(join(dir, '.env.prod'), 0o600)
  return dir
}

/** Only what docker needs: a variable of the test's own shell would win over the file. */
function dockerOnly(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']
  return Object.fromEntries(
    keep.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
  )
}

function ff(dir: string, ...args: string[]) {
  return spawnSync('bash', [join(dir, 'ff.sh'), ...args], {
    cwd: dir,
    env: dockerOnly(),
    encoding: 'utf8',
    timeout: 30_000,
  })
}

/** What compose reads from the directory's `.env.prod`, as `up -d backend` would. */
function read(dir: string): Record<string, string> {
  const out = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      'docker-compose.prod.yml',
      '--env-file',
      '.env.prod',
      'config',
      '--environment',
    ],
    { cwd: dir, env: dockerOnly(), encoding: 'utf8', timeout: 30_000 },
  ).stdout
  return Object.fromEntries(
    out
      .split('\n')
      .filter((line) => line.startsWith('FF_'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
}

const envOf = (dir: string) => readFileSync(join(dir, '.env.prod'), 'utf8')

describe('ff.sh turning an фф on', () => {
  it('adds the line production’s file never had (А6)', () => {
    const dir = machine(PRODUCTION)
    const run = ff(dir, 'venues', 'on')
    expect(run.status, run.stderr).toBe(0)
    expect(read(dir)).toEqual({ FF_VENUES: 'on' })
    // the rest of the file as it was, its mode too
    expect(envOf(dir)).toBe(`${PRODUCTION}FF_VENUES=on\n`)
    expect(statSync(join(dir, '.env.prod')).mode & 0o777).toBe(0o600)
  }, 60_000)

  it('replaces a line there is, and a second one goes', () => {
    const dir = machine(`FF_VENUES=off\n${PRODUCTION}\nFF_PAYMENTS=on\nFF_VENUES=off\n`)
    const run = ff(dir, 'venues', 'on')
    expect(run.status, run.stderr).toBe(0)
    expect(envOf(dir)).toBe(`FF_VENUES=on\n${PRODUCTION}\nFF_PAYMENTS=on\n`)
    expect(read(dir)).toEqual({ FF_VENUES: 'on', FF_PAYMENTS: 'on' })
  }, 60_000)

  it('turns it off by the same line', () => {
    const dir = machine(`${PRODUCTION}\nFF_VENUES=on\n`)
    expect(ff(dir, 'venues', 'off').status).toBe(0)
    expect(read(dir)).toEqual({ FF_VENUES: 'off' })
  }, 60_000)

  it('refuses a name the compose file does not pass, writing nothing', () => {
    const dir = machine(PRODUCTION)
    const run = ff(dir, 'paymnets', 'on')
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('FF_VENUES FF_PAYMENTS')
    expect(envOf(dir)).toBe(PRODUCTION)
  }, 60_000)

  it.each(['ON', 'true', '1'])(
    'refuses «%s» for a value',
    (value) => {
      const dir = machine(PRODUCTION)
      expect(ff(dir, 'venues', value).status).toBe(2)
      expect(envOf(dir)).toBe(PRODUCTION)
    },
    60_000,
  )
})

// A typo in a name never reaches the API: compose passes each фф by name, and the API starts with it off,
// saying nothing (А5). The script reads every фф compose does, by any spelling.
describe('ff.sh and a name compose drops', () => {
  it.each(['FF_PAYMNETS=on', 'ff_payments=on', 'FF_PAYMENT=on', 'FF-PAYMENTS=on'])(
    '«%s» stops it, named, and nothing is written',
    (line) => {
      const dir = machine(`${PRODUCTION}\n${line}\n`)
      const check = ff(dir)
      expect(check.status).toBe(1)
      expect(check.stderr).toContain(`«${line.slice(0, line.indexOf('='))}»`)
      const turn = ff(dir, 'venues', 'on')
      expect(turn.status).toBe(1)
      expect(envOf(dir)).toBe(`${PRODUCTION}\n${line}\n`)
    },
    60_000,
  )

  it('names a value the API would refuse', () => {
    const run = ff(machine(`${PRODUCTION}\nFF_PAYMENTS=ON\n`))
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('FF_PAYMENTS=ON')
  }, 60_000)

  it('passes a file with every фф right, and one with none', () => {
    const right = ff(machine(`${PRODUCTION}\nFF_VENUES=on\nFF_PAYMENTS=off\n`))
    expect(right.status, right.stderr).toBe(0)
    expect(right.stdout).toContain('FF_VENUES=on')
    expect(ff(machine(PRODUCTION)).status).toBe(0)
  }, 60_000)
})
