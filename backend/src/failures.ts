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
  const map = sourceMapOf(payload)
  return (frame) => {
    const position = BUNDLE_FRAME.exec(frame)
    return position === null ? undefined : sourceAt(map, position[1], position[2])
  }
}

function sourceMapOf(payload: object): SourceMap {
  return new SourceMap(payload as ConstructorParameters<typeof SourceMap>[0])
}

/** The source's line under a line and a column of the bundle, both counted from one. */
function sourceAt(map: SourceMap, line = '', column = ''): string | undefined {
  const generated = Number(line) - 1
  const entry = map.findEntry(generated, Number(column) - 1)
  if (!('originalSource' in entry) || entry.generatedLine !== generated) return undefined
  const source = entry.originalSource.replace(/^(?:\.\.\/)+/, '')
  return `${source}:${String(entry.originalLine + 1)}:${String(entry.originalColumn + 1)}`
}

/**
 * How long a map is waited for (review №4): the rows are read by then, and a site that does not
 * answer must not hold `make failures` — its frames are printed as they are.
 */
const MAP_TIMEOUT_MS = 10_000

/** A phone's frame of a script of the site: `at Xe (/assets/index-BTCsHrpw.js:1:48213)` (MOL-144). */
const PHONE_FRAME = /\((\/assets\/[\w.-]+\.js):(\d+):(\d+)\)$/

/**
 * The phone's frames read back through the maps published beside the build (MOL-144, Р-7 of MOL-149,
 * Р-9): each file's map from the site by the file's name, `<site>/assets/index-BTCsHrpw.js.map`. The
 * name is a hash of the file's content, so a map found is that file's own — whatever build the row
 * names. A map the site no longer has — the build was replaced — leaves its frames as they are; so
 * does a site that does not answer. Fetched once a file for one run.
 */
export async function phoneDecoder(
  rows: readonly FailureRow[],
  site: string,
  fetchMap: (url: URL) => Promise<Response> = (url) =>
    fetch(url, { signal: AbortSignal.timeout(MAP_TIMEOUT_MS) }),
): Promise<FrameDecoder> {
  const files = new Set(
    rows
      .filter((row) => row.source === 'phone')
      .flatMap((row) => row.frames.map((frame) => PHONE_FRAME.exec(frame)?.[1]))
      .filter((file) => file !== undefined),
  )
  const maps = new Map<string, SourceMap>()
  for (const file of files) {
    try {
      const response = await fetchMap(new URL(`${file}.map`, site))
      if (response.ok) maps.set(file, sourceMapOf((await response.json()) as object))
    } catch {
      // No map, no line of the source: the frame is printed as it is.
    }
  }
  return (frame) => {
    const position = PHONE_FRAME.exec(frame)
    const map = position?.[1] === undefined ? undefined : maps.get(position[1])
    return map === undefined ? undefined : sourceAt(map, position?.[2], position?.[3])
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
  phone?: (rows: readonly FailureRow[]) => Promise<FrameDecoder>,
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
  for (const line of formatFailures(rows, decoding, await phone?.(rows))) write(line)
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
 * map is in the bot's image, so its frames stay the bundle's. The phone's are read through the map
 * of their own file, from the site (MOL-144).
 */
export function formatFailures(
  rows: readonly FailureRow[],
  decoding?: { readonly build: string; readonly decode: FrameDecoder },
  phone?: FrameDecoder,
): string[] {
  if (rows.length === 0) return ['no failures in the last 30 days']
  const lines: string[] = []
  for (const row of rows) {
    const kind = row.code === null ? row.errorName : `${row.errorName} ${row.code}`
    lines.push(
      `${moment(row.lastSeenAt)}  ${row.fingerprint.slice(0, 6)}  ${row.source}  ${kind}  ${row.route ?? '(no route)'}`,
      `  ${String(row.count)} in all since ${moment(row.firstSeenAt)}, ${String(row.buildCount)} in ${row.build}${row.platform === null ? '' : ` · ${row.platform}`}`,
      ...row.frames.flatMap((frame) => {
        const source =
          row.source === 'phone'
            ? phone?.(frame)
            : decoding !== undefined && row.source === 'api' && row.build === decoding.build
              ? decoding.decode(frame)
              : undefined
        return source === undefined ? [`    ${frame}`] : [`    ${frame}`, `      → ${source}`]
      }),
      '',
    )
  }
  return lines
}
