import { Bot } from 'grammy'
import type { BotConfig, Context } from 'grammy'
import { run, sequentialize } from '@grammyjs/runner'
import type { RunnerHandle } from '@grammyjs/runner'
import { loginComposer } from './login'
import type { LoginDeps } from './login'

/**
 * The bot, wired in the one order that matters.
 *
 * Assembled by a function rather than in `index.ts` so that the wiring itself is under test:
 * what it promises — one person at a time, everybody at once — is a property of the order these
 * two middlewares are installed in, and nothing else would notice if that order changed.
 */
export function assembleBot(token: string, deps: LoginDeps, config?: BotConfig<Context>): Bot {
  const bot = new Bot<Context>(token, config)

  /**
   * **Updates of different people are handled at the same time; updates of one person, in
   * order.** Both halves are load-bearing and they pull against each other.
   *
   * `bot.start()` alone handles updates strictly one after another — grammY's own ordering
   * guarantee — and every handler here waits on the API. Measured: while the API thought about
   * one person's request for 300 ms, the next person's did not leave at all (О-4). At fifteen
   * seconds, the client's timeout, a queue of twenty presses is five minutes — the whole life
   * of a login request, so codes at the back of the queue expire before anyone looks at them.
   *
   * `sequentialize` by chat is what keeps the other half true. Without it a double tap would be
   * two confirmations in flight at once, and which message the person ends up looking at would
   * be decided by whichever answer came back first.
   */
  bot.use(sequentialize((ctx) => ctx.chat?.id.toString()))
  bot.use(loginComposer(deps))

  // The last resort: a handler that throws must not take the process with it. The update itself
  // is deliberately not logged — it carries the person's name, username and language.
  bot.catch(({ error }) => {
    console.error(`[molvia] update failed: ${error instanceof Error ? error.message : 'unknown'}`)
  })

  return bot
}

/** Long polling that actually runs handlers concurrently — the whole reason for the runner. */
export function startBot(bot: Bot): RunnerHandle {
  return run(bot)
}
