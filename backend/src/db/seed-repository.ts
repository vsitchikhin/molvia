import type { BaseUnit, NewItem } from '@molvia/model'
import type { Conn } from './index'
import { createItemRepository } from './items-repository'

/** An item the catalogue already had under a line's name — left exactly as it was. */
export interface KeptItem {
  readonly name: string
  readonly unit: BaseUnit
  /** The unit the seed would have given it: a difference is worth a look, never a rewrite. */
  readonly seeded: BaseUnit
}

export interface SeedReport {
  readonly added: number
  readonly kept: readonly KeptItem[]
}

export interface SeedRepository {
  /**
   * Writes the seed (MOL-112) in one transaction: all of it or none, so a failure on the
   * four-hundredth line leaves no half of a catalogue behind. Each line goes through
   * `createUnlessNamed` with no author — a name already there, whoever proposed it, is kept
   * with its unit — which is what makes a second run add nothing.
   *
   * A dry run is the real run, rolled back, as erasure's is: its count cannot disagree with
   * what writing does.
   */
  seed(lines: readonly NewItem[], options: { readonly dryRun: boolean }): Promise<SeedReport>
}

class DryRun extends Error {
  constructor(readonly report: SeedReport) {
    super('dry run')
  }
}

export function createSeedRepository(db: Conn): SeedRepository {
  return {
    async seed(lines, { dryRun }) {
      try {
        return await db.transaction(async (tx) => {
          const items = createItemRepository(tx)
          let added = 0
          const kept: KeptItem[] = []
          for (const line of lines) {
            const { item, created } = await items.createUnlessNamed(line, null)
            if (created) added += 1
            else kept.push({ name: item.name, unit: item.defaultUnit, seeded: line.defaultUnit })
          }

          const report: SeedReport = { added, kept }
          if (dryRun) throw new DryRun(report)
          return report
        })
      } catch (error) {
        if (error instanceof DryRun) return error.report
        throw error
      }
    },
  }
}
