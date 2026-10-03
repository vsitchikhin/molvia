import { and, asc, eq, sql } from 'drizzle-orm'
import { nameIdentity, toSearchKey } from '@molvia/model'
import type { BaseUnit, NewItem } from '@molvia/model'
import type { Conn } from './index'
import { createItemRepository, lockItemKey } from './items-repository'
import { itemHeadings, itemNames, items } from './schema'

/** An item the catalogue already had under a line's name — left exactly as it was. */
export interface KeptItem {
  readonly name: string
  readonly unit: BaseUnit
  /** The unit the seed would have given it: a difference is worth a look, never a rewrite. */
  readonly seeded: BaseUnit
}

/**
 * A line not written because the catalogue has an item of the same search key under another
 * name. Mostly the same thing spelt otherwise — «Мед» for «Мёд», «Молоко 3.2%» for «Молоко 3,2%»,
 * «Լավաշ» for «Лаваш» — which the search cannot tell apart, so a second one would split the
 * purchases and ratings of one thing. Sometimes another thing — «Milo» for «Мыло», «Kiwi» for
 * «Киви»: the key is never an identity (MOL-12), and here it is only a reason not to write. The
 * price is chosen on purpose: a line left out is proposed by hand, a twin written is there for
 * good, since the seed only adds.
 */
export interface TwinItem {
  readonly name: string
  readonly seed: string
}

export interface SeedReport {
  readonly added: number
  readonly kept: readonly KeptItem[]
  readonly twins: readonly TwinItem[]
  /** Armenian names written to the seed's items (MOL-126), the ones they had already not counted. */
  readonly names: number
  /** Customs headings written to them, likewise. */
  readonly headings: number
}

/** What a receipt reaches an item by (MOL-126), keyed by the seed's names: `catalogue-seed-nodes.ts`. */
export type SeedNodes = Readonly<
  Record<string, { readonly hy: readonly string[]; readonly hs: readonly string[] } | undefined>
>

export interface SeedRepository {
  /**
   * Writes the seed (MOL-112) in one transaction: all of it or none, so a failure on the
   * four-hundredth line leaves no half of a catalogue behind. A line whose name is there already,
   * whoever proposed it, is kept with its unit — which is what makes a second run add nothing —
   * and one whose key is there under another spelling is not written: that spelling belongs to
   * whoever wrote it. What is left goes through `createUnlessNamed` with no author.
   *
   * By the key and not only by the name, because the name alone (`nameIdentity`) knows case and
   * spacing, while the key also folds `ё`, a decimal point and the scripts — the person's «Мед»
   * would get the seed's «Мёд» beside it, and the search would toss a coin between them.
   *
   * A dry run is the real run, rolled back, as erasure's is: its count cannot disagree with
   * what writing does.
   *
   * The item a line ends at — added, or there already under its name — gets the line's Armenian
   * names and customs headings (`nodes`, MOL-126), the ones it lacks; a twin gets none, as it is
   * someone else's spelling.
   */
  seed(
    lines: readonly NewItem[],
    options: { readonly dryRun: boolean; readonly nodes?: SeedNodes },
  ): Promise<SeedReport>
}

class DryRun extends Error {
  constructor(readonly report: SeedReport) {
    super('dry run')
  }
}

export function createSeedRepository(db: Conn): SeedRepository {
  return {
    async seed(lines, { dryRun, nodes = {} }) {
      try {
        return await db.transaction(async (tx) => {
          const repository = createItemRepository(tx)
          let added = 0
          const kept: KeptItem[] = []
          const twins: TwinItem[] = []
          let names = 0
          let headings = 0
          for (const line of lines) {
            const key = toSearchKey(line.name)
            await lockItemKey(tx, line.kind, key)
            const there = await tx
              .select({ name: items.name })
              .from(items)
              .where(and(eq(items.kind, line.kind), eq(items.searchKey, key)))
              .orderBy(asc(items.createdAt), asc(items.id))
            const wanted = nameIdentity(line.name)
            const [other] = there
            if (other && !there.some((row) => nameIdentity(row.name) === wanted)) {
              twins.push({ name: other.name, seed: line.name })
              continue
            }

            const proposal = await repository.createUnlessNamed(line, null)
            // The seed writes no codes, so no code of it can be another item's.
            if ('taken' in proposal) throw new Error('a seed line with no codes met a held code')
            const { item, created } = proposal
            if (created) added += 1
            else kept.push({ name: item.name, unit: item.defaultUnit, seeded: line.defaultUnit })

            const node = nodes[line.name]
            if (node === undefined) continue
            if (node.hy.length > 0) {
              const written = await tx
                .insert(itemNames)
                .values(node.hy.map((name) => ({ itemId: item.id, language: 'hy' as const, name })))
                .onConflictDoNothing()
                .returning({ one: sql<number>`1` })
              names += written.length
            }
            if (node.hs.length > 0) {
              const written = await tx
                .insert(itemHeadings)
                .values(node.hs.map((hs) => ({ itemId: item.id, hs })))
                .onConflictDoNothing()
                .returning({ one: sql<number>`1` })
              headings += written.length
            }
          }

          const report: SeedReport = { added, kept, twins, names, headings }
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
