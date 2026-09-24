import process from 'node:process'
import { createBotClient } from '@molvia/client'
import { assembleBot, startBot } from './assemble'
import { botToken, readEnvironment, refusedNames } from './env'
import type { BotEnvironment } from './env'

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

/**
 * How long the bot waits for the API before calling it a failure — a third of the client's own
 * default, and the number is about Telegram rather than about the API.
 *
 * Every one of these calls happens with a person's finger still on a button, and the answer to
 * a press has to be given while Telegram still accepts it: a query that aged out cannot be
 * answered at all, and a refusal then reaches nobody (adversarial В1). Waiting fifteen seconds
 * for a neighbouring container to say one word buys nothing — the API's work here is one
 * indexed row — and it is the surest way to arrive too late. A press given up on early is safe
 * to repeat, because `confirm` is idempotent for the same account (О-2).
 *
 * **It bounds one call, not the age of a press, and the difference is real** (adversarial Е1):
 * presses of one chat are handled in order (`assemble.ts` says why that ordering is not
 * optional), so somebody tapping a silent API waits a whole timeout per tap — the third gets
 * its answer after three of them, which is the fifteen seconds this number was lowered from.
 * Nothing here can fix that: the alert **is** the answer to a press, a press can be answered
 * only once, and the answer is not known until the API replies. What the number does is make
 * the common case — one press, one call — comfortably fast, and that is all it claims.
 */
const API_TIMEOUT_MS = 5_000

const runner = startBot(
  assembleBot(botToken, {
    api: createBotClient({
      baseUrl: environment.apiBaseUrl,
      secret: environment.secret,
      timeoutMs: API_TIMEOUT_MS,
    }),
    appUrl: environment.appBaseUrl,
  }),
)

// The runner keeps fetching updates until it is told to stop, and a kill without this leaves
// whatever it is holding half-handled. Compose sends SIGTERM on every deploy.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void runner.stop()
  })
}

await runner.task()
