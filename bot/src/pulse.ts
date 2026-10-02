import type { Bot } from 'grammy'

/**
 * The bot's pulse (MOL-142, Р-2): after a claim of reminders went through, a ping to
 * healthchecks.io — at most once in `PULSE_EVERY_MS`, and only while the bot hears Telegram. A
 * missing ping is the owner's alarm in Telegram, sent by healthchecks.io itself, since a machine
 * that is down takes this bot with it.
 *
 * It proves the three things a sign-in needs (MOL-54): the bot reached the API, it hears Telegram,
 * and it has lived long enough not to be a crash loop. It is not in `/health` on purpose — after
 * every rollout the API would know nothing of the bot for its first minute, and the deploy would
 * roll back.
 */

/** At most this often. */
export const PULSE_EVERY_MS = 5 * 60_000

/**
 * The first beat comes no sooner than this into the process (adversarial А2, round 2 Г1). A crash
 * loop never says «alive»: a process dying on a revoked token or a second poller does not hear
 * Telegram anyway, and this is the margin on top. Five minutes here made rollouts a few minutes
 * apart add up into a false alarm — every new process stayed silent for five.
 */
export const PULSE_FIRST_AFTER_MS = 60_000

/** One ping is given up on after this, and the next claim tries again. */
export const PULSE_TIMEOUT_MS = 10_000

/**
 * Telegram is heard while a `getUpdates` succeeded this recently. A long poll answers within its
 * thirty seconds even when nobody writes, so two minutes of silence is a runner that cannot reach
 * Telegram — retrying a 502 for hours, as `@grammyjs/runner` does, with the process alive.
 */
export const HEARD_WITHIN_MS = 2 * 60_000

/**
 * A clock no NTP step can move backwards (adversarial А3): with the wall clock, a step back of an
 * hour kept the pulse silent for an hour, and the check raised a false alarm.
 */
const monotonic = (): number => performance.now()

export interface PulseOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  readonly everyMs?: number
  readonly firstAfterMs?: number
  readonly timeoutMs?: number
  /** Whether the bot hears Telegram right now (`hearTelegram`); a beat without it is skipped. */
  readonly listening?: () => boolean
}

/**
 * Returns the beat: a call that pings unless less than `everyMs` passed since the last ping that
 * succeeded, or less than `firstAfterMs` since the pulse was made — unless one is still on its
 * way, or the bot does not hear Telegram. A failed ping is tried again a claim later rather than
 * five minutes later. Claims come a minute apart and take their own time, so the beats land five
 * to six minutes apart; after a rollout the first comes one to two minutes in.
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
    now = monotonic,
    everyMs = PULSE_EVERY_MS,
    firstAfterMs = PULSE_FIRST_AFTER_MS,
    timeoutMs = PULSE_TIMEOUT_MS,
    listening = () => true,
  } = options
  // As if a ping had succeeded just long enough ago for the next to be due `firstAfterMs` in.
  let last = now() - everyMs + firstAfterMs
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
    if (now() - last < everyMs || !listening()) return
    pending = ping().finally(() => {
      pending = undefined
    })
    return pending
  }
}

/**
 * Listens to the bot's own calls for a `getUpdates` that succeeded — the runner's long poll, which
 * is the sign-in's way in — and answers whether one did within `HEARD_WITHIN_MS` (adversarial А1:
 * Telegram unreachable for half an hour, the claim and the ping still went through, and the pulse
 * said «alive» over a sign-in that was dead). Installed before the runner starts.
 */
export function hearTelegram(bot: Bot, now: () => number = monotonic): () => boolean {
  let heard: number | undefined
  bot.api.config.use(async (prev, method, payload, signal) => {
    const result = await prev(method, payload, signal)
    if (method === 'getUpdates' && result.ok) heard = now()
    return result
  })
  return () => heard !== undefined && now() - heard < HEARD_WITHIN_MS
}
