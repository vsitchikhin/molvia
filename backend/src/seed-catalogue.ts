import { newItemSchema } from '@molvia/model'
import type { SeedReport, SeedRepository } from '@/db/seed-repository'
import { describeFailure } from '@/db/failure'
import { CATALOGUE_SEED } from '@/catalogue-seed'

export const SEED_USAGE = 'usage: seed-catalogue [--yes]'

/** 0 — done or nothing to do, 1 — the database failed, 2 — the command was wrong. */
export type SeedExit = 0 | 1 | 2

/**
 * Puts the common names of `catalogue-seed.ts` into the catalogue (MOL-112). A dry run unless
 * `--yes` is given — on production the owner reads the count before anything is written. It
 * only ever adds: an item already there stays as it is, with its unit and its author, and the
 * names whose unit differs from the seed's are printed so the owner can see them.
 */
export async function seedCatalogue(
  argv: readonly string[],
  seeder: SeedRepository,
  write: (line: string) => void,
): Promise<SeedExit> {
  if (argv.some((argument) => argument !== '--yes')) {
    write(SEED_USAGE)
    return 2
  }

  const dryRun = !argv.includes('--yes')
  const lines = CATALOGUE_SEED.map(([name, unit]) =>
    newItemSchema.parse({ kind: 'product', name, defaultUnit: unit }),
  )
  let report: SeedReport
  try {
    report = await seeder.seed(lines, { dryRun })
  } catch (error) {
    // The kind of failure and never its message: a driver's message is the query with its
    // parameters, as `forget` says of its own.
    const failure = describeFailure(error)
    write(`seeding failed, nothing changed: ${failure.code ?? failure.errorName}`)
    return 1
  }

  const otherUnit = report.kept.filter((item) => item.unit !== item.seeded)
  write(`  ${'added'.padEnd(16)}${String(report.added)}`)
  write(`  ${'already there'.padEnd(16)}${String(report.kept.length)}`)
  if (otherUnit.length > 0) {
    write(`  ${'another unit'.padEnd(16)}${String(otherUnit.length)} (kept as they are)`)
    for (const item of otherUnit)
      write(`    ${item.name}: ${item.unit}, the seed says ${item.seeded}`)
  }
  write(dryRun ? 'dry run: nothing changed. Run again with --yes to write.' : 'written.')
  return 0
}
