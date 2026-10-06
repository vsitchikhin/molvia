import { describeFailure } from '@molvia/model'
import type { MergeOutcome, MergeRepository, UnmergeOutcome } from '@/db/merge-repository'

export const MERGE_USAGE = [
  'usage: merge merge <from-id> <into-id> [--yes]   the item or place <from> into <into>',
  '       merge unmerge <merge-number> [--yes]       a merge undone, by its number in the report',
  '       merge apart <id> <id> [--yes]              the two never merged or named by the night',
  '       merge candidates                           every candidate named and still apart',
  '       merge night <YYYY-MM-DD>                   every pair a night merged, or would have',
].join('\n')

/** 0 — done or nothing to do, 1 — refused or the database failed, 2 — the command was wrong. */
export type MergeExit = 0 | 1 | 2

/** A dry run is the real one, rolled back: the count it prints is the count `--yes` makes. */
export type InTransaction = <T>(
  dryRun: boolean,
  work: (merges: MergeRepository) => Promise<T>,
) => Promise<T>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const REFUSED: Readonly<Record<string, string>> = {
  missing: 'no such item or place',
  same: 'the two are one already',
  kind: 'of two kinds: a product and a dish, or a store and a venue',
  trace: 'one of the two is merged already — merge into what it was merged into',
  undone: 'undone already',
  barcodes: 'together they hold more codes than one item may',
  city: 'two cities: one name in two cities is two places (MOL-120)',
}

/**
 * The owner's hand on the merge of twins (MOL-106, В-2): a candidate of the morning's report merged by
 * its two ids — the same merge as the night's, with its journal and its undo — and a merge undone by
 * its number. A dry run unless `--yes`. What it prints is the outcome and the merge's number, nothing
 * of a person.
 */
export async function mergeCommand(
  argv: readonly string[],
  inTransaction: InTransaction,
  write: (line: string) => void,
): Promise<MergeExit> {
  const flags = argv.filter((argument) => argument.startsWith('-'))
  const [action, ...values] = argv.filter((argument) => !argument.startsWith('-'))
  if (flags.some((flag) => flag !== '--yes')) {
    write(MERGE_USAGE)
    return 2
  }
  const dryRun = !flags.includes('--yes')
  const done = dryRun ? 'dry run: nothing changed. Run again with --yes.' : 'done.'

  try {
    if (action === 'merge' && values.length === 2 && values.every((id) => UUID.test(id))) {
      const [from = '', into = ''] = values
      const outcome = await inTransaction(dryRun, async (merges): Promise<MergeOutcome> => {
        const item = await merges.mergeItems(from, into, { by: 'hand' })
        return 'refused' in item && item.refused === 'missing'
          ? merges.mergePlaces(from, into, { by: 'hand' })
          : item
      })
      if ('refused' in outcome) {
        write(`not merged: ${REFUSED[outcome.refused] ?? outcome.refused}`)
        return 1
      }
      write(
        `merged as #${String(outcome.id)} — make unmerge ID=${String(outcome.id)} takes it back`,
      )
      write(done)
      return 0
    }
    if (action === 'unmerge' && values.length === 1 && /^[1-9][0-9]{0,15}$/.test(values[0] ?? '')) {
      const id = Number(values[0])
      const outcome = await inTransaction(dryRun, (merges): Promise<UnmergeOutcome> =>
        merges.unmerge(id),
      )
      if ('refused' in outcome && outcome.refused === 'chained') {
        write(
          `not undone: the survivor was merged on since — a chain is undone from its end: undo #${String(outcome.later)} first`,
        )
        return 1
      }
      if ('refused' in outcome) {
        write(`not undone: ${REFUSED[outcome.refused] ?? outcome.refused}`)
        return 1
      }
      write(
        `#${String(id)} undone: the ${outcome.subject} is apart again, and the night leaves the pair`,
      )
      write(done)
      return 0
    }
    if (action === 'apart' && values.length === 2 && values.every((id) => UUID.test(id))) {
      const [a = '', b = ''] = values
      const outcome = await inTransaction(dryRun, (merges) => merges.apart(a, b))
      if ('refused' in outcome) {
        write(`not said: ${REFUSED[outcome.refused] ?? outcome.refused}`)
        return 1
      }
      write(
        outcome.said
          ? `apart: the night never merges or names this ${outcome.subject} pair`
          : 'apart already',
      )
      write(done)
      return 0
    }
    if (action === 'night' && values.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(values[0] ?? '')) {
      const day = values[0] ?? ''
      const night = await inTransaction(true, (merges) => merges.nightList(day))
      if (night === null) {
        write(`no finished night on ${day}`)
        return 1
      }
      for (const pair of night.pairs) {
        const place = pair.city === undefined ? '' : `place · ${pair.city} · `
        const what = `${place}«${pair.from}» → «${pair.into}»`
        if (pair.id !== undefined) write(`#${String(pair.id)} ${what}`)
        else write(`${what}\n  make apart FROM=${pair.fromId ?? ''} INTO=${pair.intoId ?? ''}`)
      }
      write(
        night.mode === 'on'
          ? `${String(night.pairs.length)} merged and standing — make unmerge ID= takes one back`
          : `${String(night.pairs.length)} would be merged — make apart says one is two things`,
      )
      return 0
    }
    if (action === 'candidates' && values.length === 0 && flags.length === 0) {
      // Only reads: the transaction is rolled back like a dry run.
      const open = await inTransaction(true, (merges) => merges.openCandidates())
      for (const pair of open) {
        const place = pair.city === null ? '' : `place · ${pair.city} · `
        write(`${pair.namedOn} ${place}«${pair.from}» → «${pair.into}»`)
        write(`  make merge FROM=${pair.fromId} INTO=${pair.intoId}`)
      }
      write(`${String(open.length)} candidates named and still apart`)
      return 0
    }
  } catch (error) {
    // The kind and never the message: a driver's message is the query with its parameters.
    const failure = describeFailure(error)
    write(`failed, nothing changed: ${failure.code ?? failure.errorName}`)
    return 1
  }
  write(MERGE_USAGE)
  return 2
}
