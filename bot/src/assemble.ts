import { Bot, GrammyError, HttpError } from 'grammy'
import type { BotConfig, Context } from 'grammy'
import { run, sequentialize } from '@grammyjs/runner'
import type { RunnerHandle } from '@grammyjs/runner'
import { eraseComposer } from './erase'
import type { EraseDeps } from './erase'
import { loginComposer } from './login'
import type { LoginDeps } from './login'
import { heardFrom, muteComposer } from './mute'
import { rateComposer } from './rate'
import { handlerOf, reportFailure } from './failure'

/**
 * The bot, wired in the one order that matters.
 *
 * Assembled by a function rather than in `index.ts` so that the wiring itself is under test:
 * what it promises — one person at a time, everybody at once — is a property of the order these
 * two middlewares are installed in, and nothing else would notice if that order changed.
 */
export function assembleBot(
  token: string,
  deps: LoginDeps & EraseDeps,
  config?: BotConfig<Context>,
): Bot {
  const bot = new Bot<Context>(token, config)

  /**
   * **Updates of different people are handled at the same time; updates of one person, in
   * order.** Both halves are load-bearing and they pull against each other.
   *
   * `bot.start()` alone handles updates strictly one after another — grammY's own ordering
   * guarantee — and every handler here waits on the API. Measured: while the API thought about
   * one person's request for 300 ms, the next person's did not leave at all (О-4). At the
   * client's timeout a queue is measured in whole timeouts — sixty presses at five seconds is
   * the entire life of a login request — so codes at the back expire before anyone looks at
   * them, and a queue built out of *different people* is the one there is no reason for.
   *
   * `sequentialize` by chat is what keeps the other half true, and it is not decoration: «Войти»
   * and «Это не я» pressed one after the other must end where the second press says, not where
   * the faster answer does. Both succeed on their own — `confirm` is idempotent and `decline`
   * works on a confirmed request — so unordered they would leave «Вход подтверждён» standing
   * over a request that was in fact put out. The price is named in `index.ts`: presses of one
   * chat queue behind each other, so a person tapping a silent API waits a timeout per tap
   * (adversarial Е1).
   */
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()))
  // Before every composer, any of which may end the update: whoever writes has not blocked the bot.
  bot.use(heardFrom(deps))
  // Before the login, which ends in a catch-all: every text is greeted and every unknown press
  // is refused there, so `/delete` and its buttons would never get past it.
  bot.use(eraseComposer(deps))
  // The scale under a rating reminder (MOL-101), before the same catch-all.
  bot.use(rateComposer(deps))
  // «Не напоминать» under it, and Telegram's word that the bot was blocked (MOL-103).
  bot.use(muteComposer(deps))
  bot.use(loginComposer(deps))

  // The last resort: a handler that throws must not take the process with it. The update itself
  // is deliberately not logged — it carries the person's name, username and language — and nor is
  // the error's message: it is logged by its kind and reported to the API by its handler (MOL-143).
  bot.catch(({ error, ctx }) => {
    reportFailure(deps.api, error, handlerOf(ctx))
  })

  return bot
}

/**
 * The updates the bot handles, named rather than left to «the previous setting» Telegram keeps for
 * a token: `my_chat_member` is how a block reaches the reminders (MOL-103), and a token once polled
 * with a narrower list would silently never hear of one.
 */
export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member'] as const

/**
 * What a failure of a call to Telegram is, for the log: Telegram's code, or `network` — never the
 * error itself. grammY's network error carries the request's address, and the bot's token is in it
 * (MOL-142, adversarial round 2 Г2, round 3 Д2).
 */
export function telegramFailure(error: unknown): string {
  if (error instanceof GrammyError) return String(error.error_code)
  if (error instanceof HttpError) return 'network'
  return 'unexpected'
}

/** The first pause between tries of a call to Telegram, and what it grows by each try. */
export const RETRY_STEP_MS = 100

/**
 * Who the bot is, asked of Telegram before the runner starts (MOL-142, adversarial round 3 Д1).
 * Left to the runner, it is grammY's `bot.init()`: a silent retry whose pause doubles up to twenty
 * minutes, so a bot started while Telegram was away stayed deaf some seventeen minutes after it came
 * back. Here the pause grows by a tenth of a second a try, as the runner's does, a 429 waits what
 * Telegram asks, and every failure is logged by its kind. Only what may pass is retried — the
 * network, a 5xx, a 429 — as grammY does; any other code is thrown, since no retry mends it: a 401
 * is a token revoked or cut short, a 404 one Telegram cannot read at all (a space or a quote
 * before it in `.env.prod`), and retried they kept a live, silent process where a crash loop is what the rollout and the guide
 * look for (adversarial round 4 Е1). A stop cuts the wait short and returns without the bot's
 * identity.
 */
export async function introduce(bot: Bot, signal?: AbortSignal): Promise<void> {
  for (let pause = RETRY_STEP_MS; !signal?.aborted; pause += RETRY_STEP_MS) {
    let wait = pause
    try {
      // grammY types its signal by the `abort-controller` package; the platform's is the same thing.
      bot.botInfo = await bot.api.getMe(signal as Parameters<typeof bot.api.getMe>[0])
      return
    } catch (error) {
      if (signal?.aborted) return
      if (error instanceof GrammyError && error.error_code < 500 && error.error_code !== 429) {
        throw error
      }
      console.error(`[molvia] telegram getMe: ${telegramFailure(error)}`)
      if (error instanceof GrammyError && error.parameters.retry_after !== undefined) {
        wait = error.parameters.retry_after * 1000
      }
    }
    await pauseFor(wait, signal)
  }
}

/** Waits `ms`, or less if `signal` aborts first. */
async function pauseFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Long polling that actually runs handlers concurrently — the whole reason for the runner.
 *
 * A failed `getUpdates` is retried with a pause growing by a tenth of a second a try, not doubling
 * (MOL-142, adversarial А1): the runner's default left the pause at some 27 minutes after half an
 * hour of Telegram down, and nobody could sign in for that long after Telegram was back. Grown
 * this way it is 19 seconds after half an hour and about a minute after five hours. The pause is
 * a timer no stop cuts short, so a stop during an outage still waits it out — seconds now, and
 * past the thirty seconds compose gives only after hours of Telegram down.
 */
export function startBot(bot: Bot): RunnerHandle {
  // The runner logs a failed `getUpdates` whole, token and all (Г2), so it is silent and the
  // failure is logged here by its kind. A call cut short by a stop is not a failure.
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method !== 'getUpdates') return prev(method, payload, signal)
    try {
      const result = await prev(method, payload, signal)
      if (!result.ok) console.error(`[molvia] telegram getUpdates: ${String(result.error_code)}`)
      return result
    } catch (error) {
      if (!signal?.aborted) console.error(`[molvia] telegram getUpdates: ${telegramFailure(error)}`)
      throw error
    }
  })
  return run(bot, {
    runner: {
      fetch: { allowed_updates: ALLOWED_UPDATES },
      retryInterval: 'quadratic',
      silent: true,
    },
  })
}
