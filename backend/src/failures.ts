import { describeFailure } from '@molvia/model'
import type { FailureRow } from '@/db/failures-repository'

export const FAILURES_USAGE = 'usage: failures [--limit <1..200>]   the latest fingerprints first'

/** 0 — read, 1 — the database failed, 2 — the command was wrong. */
export type FailuresExit = 0 | 1 | 2

const DEFAULT_LIMIT = 20
const MOST = 200

/**
 * Reads the table of failures by hand (MOL-143) — `dist/failures.js` in the API's image,
 * `make failures` in a copy. Read only. A fingerprint a block: when it last and first happened,
 * how many times in all and in its last build, where, and the frames as they were kept — the same
 * words as the owner's message, so a fingerprint from Telegram is found here by its first six.
 */
export async function failures(
  argv: readonly string[],
  read: (limit: number) => Promise<readonly FailureRow[]>,
  write: (line: string) => void,
): Promise<FailuresExit> {
  const limit = limitOf(argv)
  if (limit === null) {
    write(FAILURES_USAGE)
    return 2
  }
  let rows: readonly FailureRow[]
  try {
    rows = await read(limit)
  } catch (error) {
    // The kind of failure and never its message, as `gates` says of its own.
    const failure = describeFailure(error)
    write(`reading the failures failed: ${failure.code ?? failure.errorName}`)
    return 1
  }
  for (const line of formatFailures(rows)) write(line)
  return 0
}

function limitOf(argv: readonly string[]): number | null {
  if (argv.length === 0) return DEFAULT_LIMIT
  const [flag, value, ...rest] = argv
  if (flag !== '--limit' || value === undefined || rest.length > 0 || !/^\d{1,3}$/.test(value)) {
    return null
  }
  const limit = Number(value)
  return limit >= 1 && limit <= MOST ? limit : null
}

function moment(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace('T', ' ')}Z`
}

export function formatFailures(rows: readonly FailureRow[]): string[] {
  if (rows.length === 0) return ['no failures in the last 30 days']
  const lines: string[] = []
  for (const row of rows) {
    const kind = row.code === null ? row.errorName : `${row.errorName} ${row.code}`
    lines.push(
      `${moment(row.lastSeenAt)}  ${row.fingerprint.slice(0, 6)}  ${row.source}  ${kind}  ${row.route ?? '(no route)'}`,
      `  ${String(row.count)} in all since ${moment(row.firstSeenAt)}, ${String(row.buildCount)} in ${row.build}`,
      ...row.frames.map((frame) => `    ${frame}`),
      '',
    )
  }
  return lines
}
