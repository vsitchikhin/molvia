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
    // With no message V8 writes the name alone, and some runners still add `: ` after it.
    const headers = error.message
      ? [`${error.name}: ${error.message}`]
      : [`${error.name}: `, error.name]
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
