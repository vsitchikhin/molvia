import { describeFailure, formatQuantity } from '@molvia/model'
import type { Quantity } from '@molvia/model'
import type { RepackReport, RepackRepository } from '@/db/repack-repository'

export const REPACK_USAGE = 'usage: repack-receipts [--yes]'

/** 0 — done or nothing to do, 1 — the database failed, 2 — the command was wrong. */
export type RepackExit = 0 | 1 | 2

const shown = (quantity: Quantity) => `${formatQuantity(quantity, 'ru')} ${quantity.unit}`

/**
 * Puts the purchases recorded from receipts before MOL-264 into the package their line's name prints (owner's В-3 «а»),
 * once, after the rollout. A dry run unless `--yes` is given — the owner reads every purchase «было → станет» before
 * anything is written, as with the seed.
 */
export async function repackReceipts(
  argv: readonly string[],
  repacker: RepackRepository,
  write: (line: string) => void,
): Promise<RepackExit> {
  if (argv.some((argument) => argument !== '--yes')) {
    write(REPACK_USAGE)
    return 2
  }

  const dryRun = !argv.includes('--yes')
  let report: RepackReport
  try {
    report = await repacker.repack({ dryRun })
  } catch (error) {
    // the kind of failure and never its message: a driver's message is the query with its parameters
    const failure = describeFailure(error)
    write(`repacking failed, nothing changed: ${failure.code ?? failure.errorName}`)
    return 1
  }

  write(`  ${'purchases'.padEnd(12)}${String(report.purchases.length)}`)
  for (const purchase of report.purchases) {
    write(
      `    ${purchase.receiptId.slice(0, 8)} ${purchase.printed}: ${shown(purchase.from)} → ${shown(purchase.to)}`,
    )
  }
  write(`  ${'items'.padEnd(12)}${String(report.items.length)}`)
  for (const item of report.items) {
    write(`    ${item.name}: ${item.from} → ${item.to.unit}, usually ${shown(item.to)}`)
  }
  write(dryRun ? 'dry run: nothing changed. Run again with --yes to write.' : 'written.')
  return 0
}
