import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import type { DueBroadcast } from '@molvia/model'
import { reportDefect } from './failure'
import { Flooded, deliver, sleep } from './deliver'
import type { Wait } from './deliver'

/**
 * The message to people about a leak (MOL-237): the API queued it and hands it out in batches, the
 * bot only sends — the owner's text as it is, the one message of the bot that is not an i18n key,
 * since nobody's language is kept and the text carries both (В-2).
 */

/** The pause between two messages: 25 a second, under Telegram's 30 a second for a bot. */
export const BROADCAST_GAP_MS = 40

/** How often the bot asks: a broadcast queued by `make notify` starts within a minute. */
export const BROADCAST_EVERY_MS = 60_000

type Batch = NonNullable<DueBroadcast['broadcast']>

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'unexpected failure'

/**
 * One batch, in its order, then the word on it: everybody up to the last one written to — sent,
 * blocked (`deliver` marks the block, MOL-103) or failed. `false` when the run stops here — the API
 * did not take the word, or Telegram's flood control: then the word covers the part that went, and
 * the rest goes with the next minute. A batch whose word never arrives goes out again after its
 * lease: better twice than never.
 */
async function sendBatch(
  api: MolviaBotClient,
  telegram: Api,
  batch: Batch,
  wait: Wait,
): Promise<boolean> {
  const counts = { sent: 0, blocked: 0, failed: 0 }
  let through: string | undefined
  let flooded = false
  for (const [index, recipient] of batch.recipients.entries()) {
    if (index > 0) await wait(BROADCAST_GAP_MS)
    const message = async () =>
      telegram.sendMessage(recipient.telegramUserId, batch.text, {
        link_preview_options: { is_disabled: true },
      })
    try {
      counts[await deliver(api, recipient.telegramUserId, message, wait, 'broadcast')] += 1
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      flooded = true
      break
    }
    through = recipient.position
  }
  if (through !== undefined) {
    try {
      await api.broadcastDone({ id: batch.id, through, ...counts })
    } catch (error) {
      console.error(`[molvia] broadcast done: ${codeOf(error)}`)
      reportDefect(api, error, 'broadcast:done')
      return false
    }
    console.log(
      `[molvia] broadcast #${String(batch.id)}: sent ${String(counts.sent)}, ` +
        `blocked ${String(counts.blocked)}, failed ${String(counts.failed)}`,
    )
  }
  if (flooded) {
    console.error('[molvia] broadcast: 429 flood, the rest goes with the next minute')
    return false
  }
  return true
}

/**
 * Asks the API for a batch and sends it, batch after batch, until there is none or the bot is
 * stopping — a stop lets the batch in hand finish, its waits cut short, and asks for no other.
 */
export async function broadcastDue(
  api: MolviaBotClient,
  telegram: Api,
  wait: Wait = async (ms) => sleep(ms),
  stopping: () => boolean = () => false,
): Promise<void> {
  while (!stopping()) {
    let batch: DueBroadcast['broadcast']
    try {
      batch = (await api.claimBroadcast()).broadcast
    } catch (error) {
      console.error(`[molvia] broadcast claim: ${codeOf(error)}`)
      reportDefect(api, error, 'broadcast:claim')
      return
    }
    if (batch === null) return
    if (!(await sendBatch(api, telegram, batch, wait))) return
  }
}

/**
 * The broadcast's timer, a twin of the reminders': a run still going is not doubled, the timer keeps
 * no process alive, and a stop cuts the waits short and waits for the batch in hand.
 */
export function startBroadcasts(
  api: MolviaBotClient,
  telegram: Api,
  everyMs = BROADCAST_EVERY_MS,
): () => Promise<void> {
  let running: Promise<void> | undefined
  const stopping = new AbortController()
  const tick = (): void => {
    if (running) return
    running = broadcastDue(
      api,
      telegram,
      async (ms) => sleep(ms, stopping.signal),
      () => stopping.signal.aborted,
    ).finally(() => {
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
