import {
  describeFailure,
  glyphsMended,
  newLineName,
  receiptCard,
  receiptLineParts,
} from '@molvia/model'
import type { CatalogueNode, ItemNameLanguage, NameLexicon } from '@molvia/model'
import type { BrandSpellingRepository } from '@/db/brand-spellings-repository'
import type { RenameReport, RenameRepository } from '@/db/rename-repository'
import { TILL_WORDS_RU } from '@/receipts/till-words-ru'
import { knownTillWords, namingLexicon } from '@/usecases/bind-receipt-lines'

export const RENAME_USAGE = 'usage: rename-receipt-items [--yes]'

/** 0 — done or nothing to do, 1 — the database failed, 2 — the command was wrong. */
export type RenameExit = 0 | 1 | 2

/**
 * Gives the items recorded from receipts before MOL-261 the name their line proposes now — the brand as its package
 * spells it, the seed's kind, Russian grammar (owner's В-3 «а») — once, after the rollout. A dry run unless `--yes`
 * is given: the owner reads every name «было → станет» before anything is written, as with `make repack`.
 */
export async function renameReceiptItems(
  argv: readonly string[],
  deps: {
    readonly renamer: RenameRepository
    readonly nodes: (language: ItemNameLanguage) => Promise<CatalogueNode[]>
    /** The brands the model spelt for the receipts it read since (MOL-326): the names here ask it nothing. */
    readonly spellings: Pick<BrandSpellingRepository, 'spelt'>
  },
  write: (line: string) => void,
): Promise<RenameExit> {
  if (argv.some((argument) => argument !== '--yes')) {
    write(RENAME_USAGE)
    return 2
  }

  const dryRun = !argv.includes('--yes')
  let report: RenameReport
  try {
    const lexicons = new Map<ItemNameLanguage, NameLexicon>()
    const known = new Map<ItemNameLanguage, ReadonlySet<string>>()
    const spelt = Object.fromEntries(await deps.spellings.spelt())
    for (const language of ['hy'] as const) {
      const nodes = await deps.nodes(language)
      const lexicon = namingLexicon(nodes)
      lexicons.set(language, { ...lexicon, brands: { ...lexicon.brands, ...spelt } })
      known.set(language, knownTillWords(nodes))
    }
    report = await deps.renamer.rename({
      dryRun,
      // the line as the queue reads it: a word the model misread put right (MOL-326)
      nameOf: (printed, country, byModel) => {
        const language = receiptCard(country).nameLanguage
        const lexicon = language === null ? undefined : lexicons.get(language)
        if (language === null || lexicon === undefined) return null
        const words = known.get(language)
        const read =
          (byModel && words !== undefined ? glyphsMended(printed, words) : null) ?? printed
        return newLineName(receiptLineParts(read), TILL_WORDS_RU, lexicon)?.name ?? null
      },
    })
  } catch (error) {
    // the kind of failure and never its message: a driver's message is the query with its parameters
    const failure = describeFailure(error)
    write(`renaming failed, nothing changed: ${failure.code ?? failure.errorName}`)
    return 1
  }

  write(`  ${'renamed'.padEnd(12)}${String(report.renamed.length)}`)
  for (const item of report.renamed) write(`    ${item.from} → ${item.to}`)
  write(`  ${'taken'.padEnd(12)}${String(report.taken.length)}`)
  for (const item of report.taken)
    write(`    ${item.from} → ${item.to}: another item holds the name`)
  write(dryRun ? 'dry run: nothing changed. Run again with --yes to write.' : 'written.')
  return 0
}
