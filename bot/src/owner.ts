import { GrammyError } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { OwnerNotice } from '@molvia/model'
import { t } from './i18n'
import { telegramFailure } from './assemble'
import { sleep } from './remind'
import { reportDefect } from './failure'

/**
 * The words of one notice to the owner (MOL-143). Always Russian: the owner's language is not
 * something we keep, and the message goes without an update to read one from. Plain text, no
 * markup — a frame or a route is shown as it is, and nothing in it can break a parse.
 */
export function ownerText(notice: OwnerNotice): string {
  const kind = notice.code === undefined ? notice.errorName : `${notice.errorName} ${notice.code}`
  const what = t(undefined, 'owner.failure.what', {
    kind,
    place: notice.route ?? t(undefined, 'owner.failure.nowhere'),
  })
  if (notice.kind === 'failure_count') {
    return [
      t(undefined, 'owner.failure.again', { count: notice.count, source: notice.source }),
      what,
      t(undefined, 'owner.failure.build', { build: notice.build }),
    ].join('\n')
  }
  return [
    t(undefined, 'owner.failure.new', { source: notice.source }),
    what,
    ...(notice.frame === undefined ? [] : [notice.frame]),
    t(undefined, 'owner.failure.buildPrint', {
      build: notice.build,
      fingerprint: notice.fingerprint,
    }),
    t(undefined, 'owner.failure.more'),
  ].join('\n')
}

/** Between two messages to one chat: Telegram's limit is about one a second. */
const OWNER_PAUSE_MS = 1_100

type Wait = (ms: number) => Promise<boolean>

/**
 * One minute's notices (MOL-143): claimed from the API, which has already marked them handed, and
 * sent one by one. At most once, as the reminders are: a notice whose message failed is the log's,
 * by its kind, and `make failures` still has the count. A 429 ends the run — the rest would be
 * refused the same way — and the log says how many went with it.
 */
export async function tellOwner(
  api: MolviaBotClient,
  telegram: Api,
  wait: Wait = async (ms) => sleep(ms),
  pauseMs = OWNER_PAUSE_MS,
): Promise<void> {
  let claimed
  try {
    claimed = await api.claimOwnerNotices()
  } catch (error) {
    console.error(`[molvia] owner claim: ${error instanceof ApiError ? error.code : 'unexpected'}`)
    reportDefect(api, error, 'owner:claim')
    return
  }
  const { to, notices } = claimed
  if (to === null) return
  for (const [index, notice] of notices.entries()) {
    // The rest is marked handed already, and a rollout — every stop — is when there is a batch
    // (adversarial А4): a stop keeps Telegram's pace while its time lasts, and says what it left.
    if (index > 0 && !(await wait(pauseMs))) {
      const left = notices.length - index
      console.error(`[molvia] owner: stopping, ${String(left)} notices given up`)
      return
    }
    try {
      await telegram.sendMessage(to, ownerText(notice))
    } catch (error) {
      console.error(`[molvia] owner notice: ${telegramFailure(error)}`)
      if (error instanceof GrammyError && error.error_code === 429) {
        const left = notices.length - index - 1
        if (left > 0) console.error(`[molvia] owner: 429 flood, ${String(left)} notices given up`)
        return
      }
    }
  }
}

/** How often the bot asks: a new failure reaches the owner within a minute. */
export const OWNER_EVERY_MS = 60_000

/**
 * How long a stop goes on sending the notices already handed, at Telegram's pace: a third of the
 * bot's thirty seconds of `stop_grace_period` is left to the reminders and the runner beside it.
 * Sent without the pauses, nineteen messages in a hundred milliseconds met a 429 (adversarial Б3).
 */
export const OWNER_STOP_BUDGET_MS = 20_000

/**
 * The owner's timer, the twin of the reminders' (MOL-101): every minute the API is asked, a run
 * still going is not doubled, the timer keeps no process alive, and a stop waits for the rest —
 * sent at the same pace while `OWNER_STOP_BUDGET_MS` lasts, then given up and said so.
 */
export function startOwnerNotices(
  api: MolviaBotClient,
  telegram: Api,
  everyMs = OWNER_EVERY_MS,
  pauseMs = OWNER_PAUSE_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  let stoppedAt: number | undefined
  const wait: Wait = async (ms) => {
    if (stoppedAt === undefined && (await sleep(ms, stopping.signal))) return true
    // The stop came during the pause, or before it: the time left decides.
    const since = performance.now() - (stoppedAt ?? performance.now())
    if (since + ms > OWNER_STOP_BUDGET_MS) return false
    await sleep(ms)
    return true
  }
  const tick = (): void => {
    if (running) return
    running = tellOwner(api, telegram, wait, pauseMs).finally(() => {
      running = undefined
    })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    stoppedAt = performance.now()
    stopping.abort()
    await running
  }
}
