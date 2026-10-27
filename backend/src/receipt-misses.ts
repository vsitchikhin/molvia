import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeFailure } from '@molvia/model'
import type { ReasonCount, ReceiptMissesRepository } from '@/db/receipt-misses-repository'

export const RECEIPT_MISSES_USAGE = [
  'usage: receipt-misses reasons --from <YYYY-MM-DD> [--to <YYYY-MM-DD>]',
  '       receipt-misses show <id start> [--root <directory> | --out <directory>]',
  '       receipt-misses forget (<id start> | --read-before <YYYY-MM-DD>) [--root <directory>] [--yes]',
].join('\n')

/** 0 — done, 1 — the database or the disk failed, 2 — the command was wrong, 3 — nothing found. */
export type ReceiptMissesExit = 0 | 1 | 2 | 3

const DAY = /^\d{4}-\d{2}-\d{2}$/
// at least eight characters of an id: the notice names eight, and fewer may name another receipt
const ID_START = /^[\da-f]{8}[\da-f-]{0,28}$/i

const share = (part: number, whole: number) =>
  whole === 0 ? '—' : `${(Math.floor((part * 1000) / whole) / 10).toFixed(1)} %`

/**
 * Where `show` copies a receipt kept for the review, and where `forget` lets the copy go: a directory of its own under
 * the root — the system's temporary one by default — named by the id's start.
 */
const copyOf = (root: string | undefined, receipt: string): string =>
  join(root ?? tmpdir(), `receipt-miss-${receipt.slice(0, 8)}`)

/**
 * Lets go of every copy under the root whose review the database no longer keeps: a review goes by itself — its 21
 * days, its person erased — and its copy must not outlive it (adversarial Б3). Only the root's own directories, by
 * their name: what is under a directory of another name — copies brought from production — is not this database's.
 */
async function sweep(root: string | undefined, kept: readonly string[]): Promise<number> {
  const at = root ?? tmpdir()
  const starts = new Set(kept.map((one) => one.slice(0, 8)))
  let entries: string[]
  try {
    entries = await readdir(at)
  } catch {
    return 0
  }
  let swept = 0
  for (const entry of entries) {
    const start = /^receipt-miss-([\da-f]{8})$/.exec(entry)?.[1]
    if (start === undefined || starts.has(start)) continue
    await rm(join(at, entry), { recursive: true, force: true })
    swept += 1
  }
  return swept
}

/** Today in Yerevan, the day the window ends on by default. */
const yerevanToday = (now: Date) =>
  new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10)

/**
 * The developer's side of receipts read not whole (MOL-309), the input of the fortnightly review (MOL-310):
 * `reasons` — the counts of a window by reader and country, each share beside its n; `show` — one receipt kept,
 * its reasons line by line, what the reader read and its photo written to a directory; `forget` — what the review
 * took, let go, a dry run unless `--yes`.
 */
export async function receiptMisses(
  argv: readonly string[],
  misses: ReceiptMissesRepository,
  write: (line: string) => void,
  now: Date = new Date(),
): Promise<ReceiptMissesExit> {
  const [command, ...rest] = argv
  const flag = (name: string) => {
    const at = rest.indexOf(name)
    return at < 0 ? undefined : rest[at + 1]
  }
  try {
    if (command === 'reasons') {
      const from = flag('--from')
      const to = flag('--to') ?? yerevanToday(now)
      if (from === undefined || !DAY.test(from) || !DAY.test(to) || to < from) {
        write(RECEIPT_MISSES_USAGE)
        return 2
      }
      for (const line of reasonLines(await misses.reasons(from, to), from, to)) write(line)
      return 0
    }
    if (command === 'show') {
      const id = rest[0]
      if (id === undefined || !ID_START.test(id)) {
        write(RECEIPT_MISSES_USAGE)
        return 2
      }
      const found = await misses.kept(id)
      if (found.length === 0) {
        write(`no receipt kept for the review starts with ${id}: let go, or never kept`)
        return 3
      }
      if (found.length > 1) {
        write(`${String(found.length)} receipts start with ${id}: give more of the id`)
        return 2
      }
      const [miss] = found
      if (miss === undefined) return 3
      // a person's photo and purchases: never into the working directory, which may be the repository's — public
      // (self-review №1) — nor one the process may not write to, as the API's image (adversarial А5)
      const out = flag('--out') ?? copyOf(flag('--root'), miss.receipt)
      write(`receipt ${miss.receipt}`)
      write(`  read ${miss.readAt.toISOString()} by ${miss.readerVersion}`)
      if (miss.retakenAt !== null) {
        write(
          `  retaken ${miss.retakenAt.toISOString()}: the receipt was replaced, its review stays`,
        )
      }
      write(`  kept until ${miss.keepUntil.toISOString()}`)
      write(`  receipt: ${miss.reasons.receipt ?? 'whole'}`)
      if (miss.reasons.partly === true)
        write('  read in part: the lines come to less than the total')
      miss.reasons.lines.forEach((reason, position) => {
        write(`  line ${String(position + 1)}: ${reason ?? 'as read'}`)
      })
      await mkdir(out, { recursive: true })
      await writeFile(join(out, 'reading.json'), `${JSON.stringify(miss.reading, null, 2)}\n`)
      for (const part of miss.parts) {
        await writeFile(join(out, `part-${String(part.position)}.jpg`), part.photo)
      }
      write(`  written to ${out}: reading.json, ${String(miss.parts.length)} part(s) of the photo`)
      return 0
    }
    if (command === 'forget') {
      const dryRun = !rest.includes('--yes')
      const before = flag('--read-before')
      const id = rest.find((one) => ID_START.test(one))
      if (
        (before === undefined) === (id === undefined) ||
        (before !== undefined && !DAY.test(before))
      ) {
        write(RECEIPT_MISSES_USAGE)
        return 2
      }
      const which = id === undefined ? { readBefore: before ?? '' } : { id }
      // one rule with `show`: a start that names more than one receipt lets none go (self-review №9)
      if (id !== undefined) {
        const matched = await misses.forget(which, true)
        if (matched.length > 1) {
          write(`${String(matched.length)} receipts start with ${id}: give more of the id`)
          return 2
        }
      }
      const gone = await misses.forget(which, dryRun)
      for (const one of gone) write(`  ${one}`)
      // the copies `show` wrote under its root go with what they were copied from (adversarial Б2); one written
      // elsewhere by `--out` is the review's own to delete
      if (!dryRun) {
        for (const one of gone)
          await rm(copyOf(flag('--root'), one), { recursive: true, force: true })
        // and those of a review gone by itself — its days, its person erased — which no `forget` names
        // (adversarial Б3)
        const swept = await sweep(flag('--root'), await misses.keptIds())
        if (swept > 0) write(`  copies of reviews gone by themselves let go: ${String(swept)}`)
      }
      write(
        dryRun
          ? `dry run: ${String(gone.length)} would be let go. Run again with --yes to let them go.`
          : `let go: ${String(gone.length)}.`,
      )
      return 0
    }
    write(RECEIPT_MISSES_USAGE)
    return 2
  } catch (error) {
    // the kind of failure and never its message: a driver's message is the query with its parameters
    const failure = describeFailure(error)
    write(`receipt-misses failed: ${failure.code ?? failure.errorName}`)
    return 1
  }
}

/** The window's counts, a block a reader and country, the most frequent reason first. */
export function reasonLines(counts: readonly ReasonCount[], from: string, to: string): string[] {
  const lines = [`Receipts read not whole · days ${from} … ${to} in Yerevan (MOL-309)`]
  const blocks = [...new Set(counts.map((one) => `${one.reader} ${one.country}`))].sort()
  if (blocks.length === 0) lines.push('  nothing read in the window')
  for (const block of blocks) {
    const of = counts.filter((one) => `${one.reader} ${one.country}` === block)
    const read = (reason: string) =>
      of.find((one) => one.scope === 'read' && one.reason === reason)?.n ?? 0
    const sorted = (scope: 'receipt' | 'line') =>
      of
        .filter((one) => one.scope === scope)
        .sort((a, b) => b.n - a.n || (a.reason < b.reason ? -1 : 1))
    const receipts = read('receipts')
    const found = read('lines')
    const notWhole = sorted('receipt').reduce((all, one) => all + one.n, 0)
    const notShown = sorted('line').reduce((all, one) => all + one.n, 0)
    lines.push('', block)
    lines.push(`  ${'receipts read'.padEnd(28)}${String(receipts)}`)
    // a receipt with no items is a sum read whole (MOL-227), never «not whole»; «in part» is the server's own word,
    // beside the reasons — lines lost may stand behind a line not as printed (self-review №5, №6)
    lines.push(`  ${'  no items, a sum'.padEnd(28)}${String(read('no_items'))}`)
    lines.push(
      `  ${'  read in part'.padEnd(28)}${String(read('partly')).padEnd(8)}${share(read('partly'), receipts)}`,
    )
    lines.push(
      `  ${'  not whole'.padEnd(28)}${String(notWhole).padEnd(8)}${share(notWhole, receipts)}`,
    )
    for (const one of sorted('receipt')) {
      lines.push(
        `  ${`    ${one.reason}`.padEnd(28)}${String(one.n).padEnd(8)}${share(one.n, receipts)}`,
      )
    }
    lines.push(`  ${'lines found'.padEnd(28)}${String(found)}`)
    lines.push(
      `  ${'  not shown as read'.padEnd(28)}${String(notShown).padEnd(8)}${share(notShown, found)}`,
    )
    for (const one of sorted('line')) {
      lines.push(
        `  ${`    ${one.reason}`.padEnd(28)}${String(one.n).padEnd(8)}${share(one.n, found)}`,
      )
    }
  }
  return lines
}
