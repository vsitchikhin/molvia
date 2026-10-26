import {
  describeFailure,
  keepsEveryWord,
  newLineName,
  receiptCard,
  receiptLineParts,
} from '@molvia/model'
import type { CatalogueNode, ItemNameLanguage, NameLexicon } from '@molvia/model'
import type { RenameReport, RenameRepository } from '@/db/rename-repository'
import { TILL_WORDS_RU } from '@/receipts/till-words-ru'
import { namingLexicon } from '@/usecases/bind-receipt-lines'

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
  },
  write: (line: string) => void,
): Promise<RenameExit> {
  if (argv.some((argument) => argument !== '--yes')) {
    write(RENAME_USAGE)
    return 2
  }

  const dryRun = !argv.includes('--yes')
  // a name that would lose a word of the one the person took is not given (adversarial А6): listed, for the owner
  const lost: { readonly from: string; readonly to: string }[] = []
  let report: RenameReport
  try {
    const lexicons = new Map<ItemNameLanguage, NameLexicon>()
    for (const language of ['hy'] as const) {
      lexicons.set(language, namingLexicon(await deps.nodes(language)))
    }
    report = await deps.renamer.rename({
      dryRun,
      nameOf: (printed, country, current) => {
        const language = receiptCard(country).nameLanguage
        const lexicon = language === null ? undefined : lexicons.get(language)
        if (lexicon === undefined) return null
        const to = newLineName(receiptLineParts(printed), TILL_WORDS_RU, lexicon)?.name ?? null
        if (to === null || keepsEveryWord(current, to)) return to
        lost.push({ from: current, to })
        return null
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
  write(`  ${'kept'.padEnd(12)}${String(lost.length)}`)
  for (const item of lost) write(`    ${item.from} → ${item.to}: the new name loses a word`)
  write(dryRun ? 'dry run: nothing changed. Run again with --yes to write.' : 'written.')
  return 0
}
