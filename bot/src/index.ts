import process from 'node:process'
import { createBotClient } from '@molvia/client'
import { assembleBot, introduce, startBot, telegramFailure } from './assemble'
import { createPulse, hearTelegram } from './pulse'
import { REMIND_EVERY_MS, startReminders } from './remind'
import { startOwnerNotices } from './owner'
import { startReceiptNotices } from './receipt'
import { botToken, readEnvironment, refusedNames } from './env'
import type { RunnerHandle } from '@grammyjs/runner'
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

/**
 * How long a claim of reminders is waited for — not the press's five seconds (MOL-101,
 * adversarial А). No finger is on a button here, and the API marks everybody it hands over as it
 * goes: a claim given up on early is a minute of reminders marked and never sent. Up to fifty
 * people, each claimed in a transaction of their own, fit in it with room to spare.
 */
const CLAIM_TIMEOUT_MS = 30_000

const api = createBotClient({
  baseUrl: environment.apiBaseUrl,
  secret: environment.secret,
  timeoutMs: API_TIMEOUT_MS,
})
const bot = assembleBot(botToken, { api, appUrl: environment.appBaseUrl })
// The pulse (MOL-142) beats on a claim that went through while the runner hears Telegram; without
// a URL it never goes out. The listener goes in before the runner's first `getUpdates`.
const pulse = createPulse(environment.pulseUrl, { listening: hearTelegram(bot) })
// The rating reminders (MOL-101): every minute the API is asked who is due, and they are sent.
const claims = createBotClient({
  baseUrl: environment.apiBaseUrl,
  secret: environment.secret,
  timeoutMs: CLAIM_TIMEOUT_MS,
})
const stopReminders = startReminders(
  claims,
  bot.api,
  environment.appBaseUrl,
  REMIND_EVERY_MS,
  () => {
    void pulse()
  },
)

// The owner's notices (MOL-143): failures the API queued, claimed every minute the same way.
const stopOwnerNotices = startOwnerNotices(claims, bot.api)

// «Чек разобран» (MOL-129): receipts read that no phone was handed, claimed every minute the same way.
const stopReceiptNotices = startReceiptNotices(claims, bot.api, environment.appBaseUrl)

// The runner keeps fetching updates until it is told to stop, and a kill without this leaves
// whatever it is holding half-handled. Compose sends SIGTERM on every deploy. A stop that comes
// while the bot still asks Telegram who it is cuts that short, and the runner never starts.
const stopping = new AbortController()
let runner: RunnerHandle | undefined
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping.abort()
    // Side by side, not one after the other (adversarial З): the runner stops taking updates while
    // the evening's last messages go out, and neither waits for the other inside the grace period.
    void Promise.all([stopReminders(), stopOwnerNotices(), stopReceiptNotices(), runner?.stop()])
  })
}

// A failure the runner gives up on — a revoked token, a second poller, fifteen hours of Telegram
// away — ends the process for compose to start again. It is logged by its kind: printed whole, the
// error carries the bot's token in the request's address (MOL-142, adversarial round 3 Д2).
try {
  await introduce(bot, stopping.signal)
  if (!stopping.signal.aborted) {
    runner = startBot(bot)
    await runner.task()
  }
} catch (error) {
  console.error(`[molvia] telegram: ${telegramFailure(error)}, stopping`)
  process.exit(1)
}
