/**
 * The driver's code of a failure — a SQLSTATE such as `23505`, or `CONNECTION_ENDED`.
 *
 * `postgres` throws its own error class and drizzle wraps it: `DrizzleQueryError` carries the
 * query and its parameters, with the driver error underneath in `cause`. So the chain is walked
 * rather than the top level read — measured, not assumed. Looking only at the wrapper made every
 * foreign-key violation a 500.
 */
export function failureCodeOf(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return undefined
    if ('code' in current && typeof current.code === 'string') return current.code
    if (!('cause' in current)) return undefined
    current = current.cause
  }
  return undefined
}

/** What a failure may say about itself in a log, a terminal or the table of failures. */
export interface FailureSummary {
  readonly errorName: string
  /** The driver's code — a SQLSTATE such as `23505`, or `CONNECTION_ENDED`. */
  readonly code?: string
  /** Where it was thrown: the stack's frames, without the message that heads it. */
  readonly frames?: readonly string[]
}

/** How many frames a failure keeps: where it was thrown and the callers that matter. */
export const FAILURE_FRAMES = 8

/**
 * A failure described without a word of what it failed on (MOL-58). One rule for the API, the bot
 * and — with MOL-144 — the phone (MOL-143, Р-1).
 *
 * The message is the dangerous part, and it is dangerous for more than the driver. A
 * `DrizzleQueryError` carries the whole query and its parameters — what a person searched for,
 * their uuid, the hash of their session token — and `postgres` adds `detail` with the values of
 * the row; a `ZodError` quotes the input it refused. So nothing here reads a message: the name,
 * the code from the chain `failureCodeOf` walks, and the frames of the stack.
 *
 * **The frames are what follows the stack's own header, and nothing is judged by its shape**
 * (adversarial П-1). Picking the lines that look like `    at …` let a person's text through: a
 * review is multi-line, it rides in the driver's message as a parameter, and a line of it written
 * as a frame — or as a whole invented one — landed in `frames`, with the rest of the parameters
 * behind it. V8 writes the stack as `name: message` and then the frames, so the header is cut off
 * whole, however many lines it spans; a stack that does not begin with it gives no frames at all
 * rather than a guess.
 */
export function describeFailure(error: unknown): FailureSummary {
  const errorName = error instanceof Error ? error.name : typeof error
  const raw = failureCodeOf(error)
  const code = raw !== undefined && /^[\dA-Z_]{1,64}$/.test(raw) ? raw : undefined
  let frames: string[] | undefined
  if (error instanceof Error && typeof error.stack === 'string') {
    // With no message V8 writes the name alone, and some runners still add `: ` after it. Node's
    // own errors put their code into the head — `RangeError [ERR_OUT_OF_RANGE]: …` — and without
    // that form the commonest mistake in Node lost every frame (adversarial А5): bare `node` writes
    // it so, while vitest's own `prepareStackTrace` does not, so the tests never saw it.
    const names =
      'code' in error && typeof error.code === 'string'
        ? [error.name, `${error.name} [${error.code}]`]
        : [error.name]
    const headers = names.flatMap((name) =>
      error.message ? [`${name}: ${error.message}`] : [`${name}: `, name],
    )
    const header = headers.find((candidate) => error.stack?.startsWith(`${candidate}\n`))
    if (header !== undefined) {
      frames = error.stack
        .slice(header.length + 1)
        .split('\n')
        .slice(0, FAILURE_FRAMES)
        .map((line) => line.trim())
    }
  }
  return {
    errorName,
    ...(code === undefined ? {} : { code }),
    ...(frames?.length ? { frames } : {}),
  }
}

/** A frame's function as the phone sends it: an identifier and nothing a sentence could be. */
const FRAME_FUNCTION = /^[\w$.<>[\]/]{1,100}$/
/** A path of the app's own origin, as a script's file can be named — never a query or a hash. */
const OWN_PATH = /^\/[\w./@~+-]{0,400}$/

/**
 * Where a frame's code is, as the phone sends it (MOL-144, Р-1): a path of the app's own origin with
 * its line and column, or `?` for anything else — another origin, an extension, `eval`, native code.
 * The query and the hash are cut: a page's own address can stand in a frame, and its query is what a
 * person searched for.
 */
function framePlaceOf(location: string, origin: string): string {
  const position = /^(.*):(\d{1,9}):(\d{1,9})$/.exec(location)
  if (position === null) return '?'
  const [, address = '', line = '', column = ''] = position
  if (!address.startsWith(`${origin}/`)) return '?'
  const path = address.slice(origin.length).replace(/[?#].*$/, '')
  return OWN_PATH.test(path) ? `${path}:${line}:${column}` : '?'
}

/**
 * One line of a browser's stack brought to one shape for every engine (MOL-144, Р-1) —
 * `at <function> (<path>:<line>:<column>)` — or nothing, for a line that is not a frame. V8 writes
 * `at fn (url:1:2)`, WebKit and Gecko `fn@url:1:2`; the function is kept only while it is an
 * identifier, `?` otherwise, so a line of text never passes for one.
 */
export function phoneFrame(line: string, origin: string): string | undefined {
  let name: string
  let location: string
  if (line.startsWith('at ')) {
    const called = /^at (.+?) \((.*)\)$/.exec(line)
    name = called?.[1] ?? ''
    location = called?.[2] ?? line.slice(3)
  } else {
    const at = line.indexOf('@')
    name = at < 0 ? '' : line.slice(0, at)
    location = at < 0 ? line : line.slice(at + 1)
    if (!/:\d{1,9}:\d{1,9}$/.test(location)) return undefined
  }
  const bare = name.replace(/^(?:async\*|async |new )/, '')
  const fn = bare === '' ? '<anonymous>' : FRAME_FUNCTION.test(bare) ? bare : '?'
  return `at ${fn} (${framePlaceOf(location, origin)})`
}

/** Whether a frame the phone sends is in the app's own code, not another origin's or native. */
export function ownFrame(frame: string): boolean {
  return !frame.endsWith('(?)')
}

/**
 * A failure on the phone, described as `describeFailure` describes one and its frames brought to
 * one shape (MOL-144, Р-1). **WebKit and Gecko write the stack without a header** — frames alone,
 * `fn@url:1:2` — so the rule that cuts V8's header gave an iPhone no frames at all. Their stack never
 * holds the message, so it is read line by line — **only while the message is nowhere in it**: a
 * stack that holds it is not one of theirs, and gives no frames, as before.
 */
export function describePhoneFailure(error: unknown, origin: string): FailureSummary {
  const summary = describeFailure(error)
  let lines = summary.frames
  if (
    lines === undefined &&
    error instanceof Error &&
    typeof error.stack === 'string' &&
    (error.message === '' || !error.stack.includes(error.message))
  ) {
    lines = error.stack.split('\n').map((line) => line.trim())
  }
  const frames = (lines ?? [])
    .map((line) => phoneFrame(line, origin))
    .filter((frame) => frame !== undefined)
    .slice(0, FAILURE_FRAMES)
  return {
    errorName: summary.errorName,
    ...(summary.code === undefined ? {} : { code: summary.code }),
    ...(frames.length > 0 ? { frames } : {}),
  }
}
