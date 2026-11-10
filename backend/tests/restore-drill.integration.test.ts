/**
 * `deploy/backup/restore.sh --drill` judging what it restored (MOL-368, audit MOL-287 Ф-19).
 *
 * The script runs as it is, in a directory of its own beside the `backup.sh` given; `ssh` and `age` are
 * stand-ins first in `PATH`, so nothing leaves the machine. The fake `ssh` answers `rclone lsf` with a
 * copy's name and `psql` with the «schema.table count» lines of the files `live` and `restored`.
 * No database: it sits here because a script of the deploy is tested by running it.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const made: string[] = []

const FAKE_SSH = `#!/bin/bash
cmd="\${*: -1}"
case "$cmd" in
  *"rclone lsf"*) echo "molvia-2026-11-10T0300Z.dump.age" ;;
  *"rclone cat"*) echo copy ;;
  *"pg_restore"*) cat >/dev/null ;;
  *psql*) input="$(cat)"
    if [[ "$input" == *"select format("* ]]; then echo "statements"
    elif [[ "$cmd" == *molvia-restore-drill* ]]; then cat "$FAKE/restored"
    else cat "$FAKE/live"; fi ;;
  *) : ;;
esac
`

const BACKUP = `#!/usr/bin/env bash
pg_dump --exclude-table-data=receipt_parts --exclude-table-data=receipt_links
`

const COPY = ['drizzle.__drizzle_migrations 80', 'public.events 120', 'public.receipt_links 0']

/** A drill in a directory of its own, beside the `backup.sh` given — or none. */
function drill(backup: string | null, live: string[], restored: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'molvia-drill-'))
  made.push(dir)
  copyFileSync(join(REPO, 'deploy/backup/restore.sh'), join(dir, 'restore.sh'))
  if (backup !== null) writeFileSync(join(dir, 'backup.sh'), backup)
  writeFileSync(join(dir, 'ssh'), FAKE_SSH)
  writeFileSync(join(dir, 'age'), '#!/bin/sh\ncat\n')
  chmodSync(join(dir, 'ssh'), 0o755)
  chmodSync(join(dir, 'age'), 0o755)
  writeFileSync(join(dir, 'key'), '')
  writeFileSync(join(dir, 'live'), `${live.join('\n')}\n`)
  writeFileSync(join(dir, 'restored'), `${restored.join('\n')}\n`)
  return spawnSync('bash', [join(dir, 'restore.sh'), '--drill'], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      FAKE: dir,
      AGE_KEY: join(dir, 'key'),
    },
    encoding: 'utf8',
    timeout: 20_000,
  })
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('restore.sh --drill', () => {
  it('passes a copy whose tables match and whose excluded tables came back empty', () => {
    const run = drill(
      BACKUP,
      [...COPY, 'public.receipt_parts 3'],
      [...COPY, 'public.receipt_parts 0'],
    )

    expect(run.stderr).toBe('')
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('public.receipt_parts · 3 · 0   excluded')
    expect(run.stdout).toContain('every table excluded from the copy came back empty')
  }, 30_000)

  it('fails a copy that carried rows of a table it leaves out, whatever the live one holds', () => {
    const run = drill(
      BACKUP,
      [...COPY, 'public.receipt_parts 3'],
      [...COPY, 'public.receipt_parts 3'],
    )

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('public.receipt_parts · 3 · 3   excluded, must be empty')
    expect(run.stderr).toContain('a table excluded from the copy is not empty')
  }, 30_000)

  it('fails a table backup.sh excludes that the database has not got', () => {
    const run = drill(BACKUP, COPY, COPY)

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('public.receipt_parts · excluded in backup.sh, no such table')
  }, 30_000)

  it('says counts differ of any other table', () => {
    const run = drill(
      BACKUP,
      [...COPY, 'public.receipt_parts 3'],
      [...COPY.map((line) => line.replace('events 120', 'events 3')), 'public.receipt_parts 0'],
    )

    expect(run.status).toBe(1)
    expect(run.stdout).toContain('public.events · 120 · 3   ≠')
    expect(run.stderr).toContain('counts differ')
  }, 30_000)

  it('says why when backup.sh excludes nothing, or is not beside it (adversarial А2)', () => {
    const none = drill('#!/usr/bin/env bash\npg_dump --format=custom\n', COPY, COPY)
    const missing = drill(null, COPY, COPY)

    expect(none.status).toBe(1)
    expect(none.stderr).toContain('drill: no table excluded in backup.sh was read')
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('drill: no backup.sh beside restore.sh')
  }, 30_000)
})
