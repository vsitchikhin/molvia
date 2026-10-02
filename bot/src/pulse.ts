/**
 * The bot's pulse (MOL-142, Р-2): after a claim of reminders went through, a ping to
 * healthchecks.io — at most once in `PULSE_EVERY_MS`. A missing ping is the owner's alarm in
 * Telegram, sent by healthchecks.io itself, since a machine that is down takes this bot with it.
 *
 * It proves more than a live process: the bot reached the API and the internet. It is not in
 * `/health` on purpose — after every rollout the API would know nothing of the bot for its first
 * minute, and the deploy would roll back.
 */

/** The check's period in healthchecks.io; the grace there is ten minutes on top of it. */
export const PULSE_EVERY_MS = 5 * 60_000

/** One ping is given up on after this, and the next claim tries again. */
export const PULSE_TIMEOUT_MS = 10_000

export interface PulseOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  readonly everyMs?: number
  readonly timeoutMs?: number
}

/**
 * Returns the beat: a call that pings unless a successful ping started less than `everyMs` ago or
 * one is still on its way. Counted from the last ping that succeeded, so a failed one is tried
 * again a claim later rather than five minutes later. Since claims come a minute apart and take
 * their own time, the beats land five to six minutes apart — well inside the check's grace.
 *
 * Without a URL — every working copy and the end-to-end run — the beat does nothing at all. The
 * URL is never printed: whoever has it can say «alive» for us. A failure is logged by its kind.
 * The beat never rejects.
 */
export function createPulse(
  url: string | undefined,
  options: PulseOptions = {},
): () => Promise<void> {
  if (!url) return async () => Promise.resolve()
  const {
    fetch = globalThis.fetch,
    now = Date.now,
    everyMs = PULSE_EVERY_MS,
    timeoutMs = PULSE_TIMEOUT_MS,
  } = options
  let last: number | undefined
  let pending: Promise<void> | undefined

  const ping = async (): Promise<void> => {
    const started = now()
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
      await response.body?.cancel()
      if (!response.ok) {
        console.error(`[molvia] pulse: ${String(response.status)}`)
        return
      }
      last = started
    } catch (error) {
      const kind = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network'
      console.error(`[molvia] pulse: ${kind}`)
    }
  }

  return async () => {
    if (pending) return pending
    if (last !== undefined && now() - last < everyMs) return
    pending = ping().finally(() => {
      pending = undefined
    })
    return pending
  }
}
