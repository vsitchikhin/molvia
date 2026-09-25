import { telegramUserIdSchema } from '@molvia/model'
import type { ErasureReport, ErasureRepository } from '@/db/erasure-repository'
import { describeFailure } from '@/db/failure'
import { ERASED_TABLES } from '@/db/erasure-repository'

export const FORGET_USAGE = 'usage: forget <telegram-user-id> [--yes]'

/** 0 — done or nothing to do, 1 — the database failed, 2 — the command was wrong. */
export type ForgetExit = 0 | 1 | 2

/**
 * The owner's fallback for erasing a person by hand (MOL-58) — people themselves use `/delete`
 * in the bot. A dry run unless `--yes` is given: nothing can undo it and there are no backups,
 * so a second look costs less than one wrong digit in an id.
 *
 * What it prints is counts and table names and nothing else — no names, no reviews, not even the
 * owner's uuid — because the output lands in a terminal and its scrollback.
 */
export async function forget(
  argv: readonly string[],
  erasure: ErasureRepository,
  write: (line: string) => void,
): Promise<ForgetExit> {
  const flags = argv.filter((argument) => argument.startsWith('-'))
  const values = argv.filter((argument) => !argument.startsWith('-'))
  const unknown = flags.filter((flag) => flag !== '--yes')
  // Digits only before `Number`: it would read `1e3`, `0x10` and ` 42` as ids.
  const raw = values.length === 1 && /^[0-9]+$/.test(values[0] ?? '') ? Number(values[0]) : NaN
  const id = telegramUserIdSchema.safeParse(raw)
  if (unknown.length > 0 || !id.success) {
    write(FORGET_USAGE)
    return 2
  }

  const dryRun = !flags.includes('--yes')
  let report: ErasureReport
  try {
    report = await erasure.erase(id.data, { dryRun })
  } catch (error) {
    // The kind of failure and never its message: a driver's message is the query with its
    // parameters — the very uuid this output promises to keep out of the scrollback.
    const failure = describeFailure(error)
    write(`erasure failed, nothing changed: ${failure.code ?? failure.errorName}`)
    return 1
  }

  write(report.found ? 'owner found' : 'no owner with this Telegram id')
  for (const table of ERASED_TABLES) write(`  ${table.padEnd(16)}${String(report.erased[table])}`)
  write(`  ${'items kept'.padEnd(16)}${String(report.itemsReleased)} (author removed)`)
  write(dryRun ? 'dry run: nothing changed. Run again with --yes to erase.' : 'erased.')
  return 0
}
