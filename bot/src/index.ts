import process from 'node:process'
import { Bot } from 'grammy'
import { createBotClient } from '@molvia/client'
import { botToken, readEnvironment, refusedNames } from './env'
import type { BotEnvironment } from './env'
import { loginComposer } from './login'

// Every working copy needs its own bot: two processes on one token steal each other's
// updates through long polling, silently. A copy without a token simply does not start.
if (!botToken) {
  console.log('TELEGRAM_BOT_TOKEN is empty — this copy has no bot of its own, not starting')
  process.exit(0)
}

// Absent configuration and wrong configuration are not the same thing, and only the first one
// exits 0 (see `botToken`). A value that is there and malformed is a defect of this copy: it is
// named — by variable, never by value — and the process fails.
let environment: BotEnvironment
try {
  environment = readEnvironment()
} catch (error) {
  console.error(`[molvia] the bot's environment does not parse: ${refusedNames(error)}`)
  process.exit(1)
}

// And the same for the channel's secret (MOL-55, Q3): without it the bot cannot confirm a
// single login, which is the only thing it does in 0.1 — so it says so at startup rather than
// on the first button somebody presses. Exit 0, like the missing token above: «this copy has no
// bot» must not turn into a restart loop under compose. Production cannot reach this line —
// `docker-compose.prod.yml` refuses to start without the variable.
if (!environment.secret) {
  console.log('BOT_API_SECRET is empty — the bot cannot confirm a login, not starting')
  process.exit(0)
}

const bot = new Bot(botToken)

bot.use(
  loginComposer({
    api: createBotClient({ baseUrl: environment.apiBaseUrl, secret: environment.secret }),
    appUrl: environment.appBaseUrl,
  }),
)

// The last resort: a handler that throws must not take the process with it. The update itself
// is deliberately not logged — it carries the person's name, username and language.
bot.catch(({ error }) => {
  console.error(`[molvia] update failed: ${error instanceof Error ? error.message : 'unknown'}`)
})

await bot.start()
