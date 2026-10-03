import { readFileSync } from 'node:fs'

export interface JournalEntry {
  readonly idx: number
  readonly when: number
  readonly tag: string
}

/** The migrations drizzle knows of, in the order it runs them. */
export function journalOf(folder: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(`${folder}/meta/_journal.json`, 'utf8')) as {
    entries: JournalEntry[]
  }
  return journal.entries
}

/**
 * The entries whose stamp is not later than the one before (MOL-105, adversarial Б). drizzle runs
 * a migration only if its stamp is later than the last applied, so such an entry is skipped on
 * every database that ran its predecessor — in silence. Two branches' migrations meet like this
 * when the later stamp merges first: the one that comes second is renumbered and must be stamped
 * anew, before its merge.
 */
export function stampsOutOfOrder(entries: readonly JournalEntry[]): JournalEntry[] {
  return entries.filter(
    (entry, index) => index > 0 && entry.when <= (entries[index - 1]?.when ?? 0),
  )
}
