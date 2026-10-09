import { BROADCAST_BATCH } from '@molvia/model'
import type { BroadcastDone, DueBroadcast, TelegramUserId } from '@molvia/model'
import type { BroadcastRepository } from '@/db/broadcasts-repository'

/**
 * The next batch of the message to people about a leak (MOL-237), handed to the bot the way the
 * rating reminders are: whom it goes to is decided here — the audience, the moment it was queued, a
 * blocked bot — and the bot only sends. `owner` is whom a try on the owner alone goes to.
 */
export async function claimBroadcast(
  broadcasts: Pick<BroadcastRepository, 'claim'>,
  owner: TelegramUserId | null,
): Promise<DueBroadcast> {
  const batch = await broadcasts.claim(owner, BROADCAST_BATCH)
  return {
    broadcast: batch && { id: batch.id, text: batch.text, recipients: [...batch.recipients] },
  }
}

/** The bot's word on a batch: the cursor moves on, the outcomes are counted (MOL-237). */
export async function broadcastDone(
  broadcasts: Pick<BroadcastRepository, 'done'>,
  report: BroadcastDone,
): Promise<void> {
  await broadcasts.done(report)
}
