import { SourceMap } from 'node:module'
import { describeFailure } from '@molvia/model'
import type { FailureRow } from '@/db/failures-repository'

/** Where a frame of the bundle came from in the source, or nothing when the map does not say. */
export type FrameDecoder = (frame: string) => string | undefined

/** A frame of the API's bundle: `at rateItem (file:///app/dist/index.js:48213:7)`. */
const BUNDLE_FRAME = /(?:\(|\s)\S*\/dist\/index\.js:(\d+):(\d+)\)?$/

/**
 * The frames of the API's bundle read back through its map (MOL-143, В-6). The API runs without
 * `--enable-source-maps`: Node parses the whole map of a 5.8 MB bundle at the first stack and keeps
 * it — +70…80 MB of the API's heap, measured — so the table and the owner's message keep the
 * bundle's frames, whose function names are the source's (`keepNames`), and this puts the line back
 * by hand. Node's own `SourceMap`, no dependency. A line the map has no entry for is left as it is,
 * rather than given the nearest one before it.
 */
export function bundleDecoder(payload: object): FrameDecoder {
  const map = new SourceMap(payload as ConstructorParameters<typeof SourceMap>[0])
  return (frame) => {
    const position = BUNDLE_FRAME.exec(frame)
    if (position === null) return undefined
    const line = Number(position[1]) - 1
    const column = Number(position[2]) - 1
    const entry = map.findEntry(line, column)
    if (!('originalSource' in entry) || entry.generatedLine !== line) return undefined
    const source = entry.originalSource.replace(/^(?:\.\.\/)+/, '')
    return `${source}:${String(entry.originalLine + 1)}:${String(entry.originalColumn + 1)}`
  }
}

export const FAILURES_USAGE = 'usage: failures [--limit <1..200>]   the latest fingerprints first'

/** 0 — read, 1 — the database failed, 2 — the command was wrong. */
export type FailuresExit = 0 | 1 | 2

const DEFAULT_LIMIT = 20
const MOST = 200

/**
 * Reads the table of failures by hand (MOL-143) — `dist/failures.js` in the API's image,
 * `make failures` in a copy. Read only. A fingerprint a block: when it last and first happened,
 * how many times in all and in its last build, where, and the frames as they were kept — the same
 * words as the owner's message, so a fingerprint from Telegram is found here by its first six.
 */
export async function failures(
  argv: readonly string[],
  read: (limit: number) => Promise<readonly FailureRow[]>,
  write: (line: string) => void,
  decoding?: { readonly build: string; readonly decode: FrameDecoder },
): Promise<FailuresExit> {
  const limit = limitOf(argv)
  if (limit === null) {
    write(FAILURES_USAGE)
    return 2
  }
  let rows: readonly FailureRow[]
  try {
    rows = await read(limit)
  } catch (error) {
    // The kind of failure and never its message, as `gates` says of its own.
    const failure = describeFailure(error)
    write(`reading the failures failed: ${failure.code ?? failure.errorName}`)
    return 1
  }
  for (const line of formatFailures(rows, decoding)) write(line)
  return 0
}

function limitOf(argv: readonly string[]): number | null {
  if (argv.length === 0) return DEFAULT_LIMIT
  const [flag, value, ...rest] = argv
  if (flag !== '--limit' || value === undefined || rest.length > 0 || !/^\d{1,3}$/.test(value)) {
    return null
  }
  const limit = Number(value)
  return limit >= 1 && limit <= MOST ? limit : null
}

function moment(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace('T', ' ')}Z`
}

/**
 * A fingerprint a block. Frames are read back through the map only for the API's failures of the
 * build this image is — another build's lines would be read through the wrong map — and the bot's
 * map is in the bot's image, so its frames stay the bundle's.
 */
export function formatFailures(
  rows: readonly FailureRow[],
  decoding?: { readonly build: string; readonly decode: FrameDecoder },
): string[] {
  if (rows.length === 0) return ['no failures in the last 30 days']
  const lines: string[] = []
  for (const row of rows) {
    const kind = row.code === null ? row.errorName : `${row.errorName} ${row.code}`
    lines.push(
      `${moment(row.lastSeenAt)}  ${row.fingerprint.slice(0, 6)}  ${row.source}  ${kind}  ${row.route ?? '(no route)'}`,
      `  ${String(row.count)} in all since ${moment(row.firstSeenAt)}, ${String(row.buildCount)} in ${row.build}`,
      ...row.frames.flatMap((frame) => {
        const source =
          decoding !== undefined && row.source === 'api' && row.build === decoding.build
            ? decoding.decode(frame)
            : undefined
        return source === undefined ? [`    ${frame}`] : [`    ${frame}`, `      → ${source}`]
      }),
      '',
    )
  }
  return lines
}
