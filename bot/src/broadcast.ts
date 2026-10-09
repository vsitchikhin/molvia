import type { Api } from 'grammy'
import { ApiError } from '@molvia/client'
import type { MolviaBotClient } from '@molvia/client'
import { BROADCAST_BATCH } from '@molvia/model'
import type { DueBroadcast } from '@molvia/model'
import { reportDefect } from './failure'
import { Flooded, deliver, sleep } from './deliver'
import type { Delivered, Wait } from './deliver'

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

/** Why a batch ended before its last person: the rest goes with the next minute. */
const STOPPED_BY = {
  flood: '429 flood',
  again: 'a failure that may pass',
  refused: 'Telegram refused two in a row — the message itself',
  stop: 'the bot stopping',
} as const

/**
 * One batch, in its order, then the word on it: everybody up to the last one done — sent, blocked
 * (`deliver` marks the block, MOL-103) or not delivered for good. **Nothing else moves the cursor past a
 * person** (adversarial А1): a failure that may pass — the network, Telegram's 5xx, a revoked token, a
 * second 429 — Telegram's flood control and the bot stopping each end the batch there, the word covers
 * the part that went, and the rest goes with the next minute; with nothing gone the word only lets the
 * lease go. A stop sends nothing more, so no volley without the pauses meets a 429 it cannot wait out.
 *
 * **A request Telegram refuses (`refused`, another 4xx) is judged by the next person** (adversarial
 * Р2-А1): it is about that one chat or about the message itself, and Telegram does not say which. The
 * next one goes — it was the chat's, so that person is «не дошло» for good and the broadcast goes on;
 * the next one is refused too — it is the message's, and the batch stops before the first of them, as
 * it would for every one after. The last person of the broadcast has nobody after them — a batch
 * shorter than a whole one is its end — and is not delivered for good: one refused request is not
 * worth holding a finished broadcast for, nor the owner's try, which goes before the people's. A whole
 * batch ending on one leaves them first in the next batch, where their next one is.
 *
 * `false` when the run stops here; a word that never arrives leaves the batch to go again after its
 * lease — better twice than never.
 */
async function sendBatch(
  api: MolviaBotClient,
  telegram: Api,
  batch: Batch,
  wait: Wait,
  stopping: () => boolean,
): Promise<boolean> {
  const counts = { sent: 0, blocked: 0, failed: 0 }
  let through: string | null = null
  // a refused person whose verdict waits for the next one
  let held: string | null = null
  let stopped: keyof typeof STOPPED_BY | null = null
  for (const [index, recipient] of batch.recipients.entries()) {
    // after the pause: a stop comes while waiting more often than not
    if (index > 0) await wait(BROADCAST_GAP_MS)
    if (stopping()) {
      stopped = 'stop'
      break
    }
    const message = async () =>
      telegram.sendMessage(recipient.telegramUserId, batch.text, {
        link_preview_options: { is_disabled: true },
      })
    let outcome: Delivered
    try {
      outcome = await deliver(api, recipient.telegramUserId, message, wait, 'broadcast')
    } catch (error) {
      if (!(error instanceof Flooded)) throw error
      stopped = 'flood'
      break
    }
    if (outcome === 'again') {
      stopped = 'again'
      break
    }
    if (outcome === 'refused') {
      if (held !== null) {
        stopped = 'refused'
        break
      }
      held = recipient.position
      continue
    }
    if (held !== null) {
      counts.failed += 1
      held = null
    }
    counts[outcome] += 1
    through = recipient.position
  }
  if (held !== null && stopped === null && batch.recipients.length < BROADCAST_BATCH) {
    counts.failed += 1
    through = held
  }
  try {
    await api.broadcastDone({ id: batch.id, through, ...counts })
  } catch (error) {
    console.error(`[molvia] broadcast done: ${codeOf(error)}`)
    reportDefect(api, error, 'broadcast:done')
    return false
  }
  if (through !== null) {
    console.log(
      `[molvia] broadcast #${String(batch.id)}: sent ${String(counts.sent)}, ` +
        `blocked ${String(counts.blocked)}, failed ${String(counts.failed)}`,
    )
  }
  if (stopped !== null) {
    console.error(`[molvia] broadcast: ${STOPPED_BY[stopped]}, the rest goes with the next minute`)
    return false
  }
  return true
}

/**
 * Asks the API for a batch and sends it, batch after batch, until there is none or the bot is
 * stopping — a stop ends the batch in hand where it is and asks for no other.
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
    if (!(await sendBatch(api, telegram, batch, wait, stopping))) return
  }
}

/**
 * The broadcast's timer, a twin of the reminders': a run still going is not doubled, the timer keeps
 * no process alive, and a stop cuts the wait in hand short and waits for the word on the batch.
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
