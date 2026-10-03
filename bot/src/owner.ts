import { GrammyError } from 'grammy'
import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { OwnerNotice } from '@molvia/model'
import { t } from './i18n'
import { telegramFailure } from './assemble'
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
 * refused the same way, and they are gone too: a heap of old notices is worth less than none.
 */
export async function tellOwner(
  api: MolviaBotClient,
  telegram: Api,
  wait: Wait = async (ms) => sleep(ms),
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
    if (index > 0 && !(await wait(OWNER_PAUSE_MS))) return
    try {
      await telegram.sendMessage(to, ownerText(notice))
    } catch (error) {
      console.error(`[molvia] owner notice: ${telegramFailure(error)}`)
      if (error instanceof GrammyError && error.error_code === 429) return
    }
  }
}

/** Waits `ms`, or less if `signal` aborts first: `true` for the whole wait, `false` for a cut. */
async function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cut)
      resolve(true)
    }, ms)
    const cut = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', cut, { once: true })
  })
}

/** How often the bot asks: a new failure reaches the owner within a minute. */
export const OWNER_EVERY_MS = 60_000

/**
 * The owner's timer, the twin of the reminders' (MOL-101): every minute the API is asked, a run
 * still going is not doubled, the timer keeps no process alive, and a stop cuts the pauses short and
 * waits for the rest.
 */
export function startOwnerNotices(
  api: MolviaBotClient,
  telegram: Api,
  everyMs = OWNER_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = tellOwner(api, telegram, async (ms) => sleep(ms, stopping.signal)).finally(() => {
      running = undefined
    })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return async () => {
    clearInterval(timer)
    stopping.abort()
    await running
  }
}
