import process from 'node:process'
import { Bot } from 'grammy'
import { createBotClient } from '@molvia/client'
import { env, apiBaseUrl, appBaseUrl } from './env'
import { loginComposer } from './login'

// Every working copy needs its own bot: two processes on one token steal each other's
// updates through long polling, silently. A copy without a token simply does not start.
if (!env.TELEGRAM_BOT_TOKEN) {
  console.log('TELEGRAM_BOT_TOKEN is empty — this copy has no bot of its own, not starting')
  process.exit(0)
}

// And the same for the channel's secret (MOL-55, Q3): without it the bot cannot confirm a
// single login, which is the only thing it does in 0.1 — so it says so at startup rather than
// on the first button somebody presses. Exit 0, like the missing token above: «this copy has no
// bot» must not turn into a restart loop under compose. Production cannot reach this line —
// `docker-compose.prod.yml` refuses to start without the variable.
if (!env.BOT_API_SECRET) {
  console.log('BOT_API_SECRET is empty — the bot cannot confirm a login, not starting')
  process.exit(0)
}

const bot = new Bot(env.TELEGRAM_BOT_TOKEN)

bot.use(
  loginComposer({
    api: createBotClient({ baseUrl: apiBaseUrl, secret: env.BOT_API_SECRET }),
    appUrl: appBaseUrl,
  }),
)

// The last resort: a handler that throws must not take the process with it. The update itself
// is deliberately not logged — it carries the person's name, username and language.
bot.catch(({ error }) => {
  console.error(`[molvia] update failed: ${error instanceof Error ? error.message : 'unknown'}`)
})

await bot.start()
