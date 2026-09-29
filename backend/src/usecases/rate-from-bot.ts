import { DomainError, ERROR } from '@molvia/model'
import type { RateFromBot } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { ReminderRepository } from '@/db/reminders-repository'
import { rateItem } from './rate-item'
import type { RateItemDeps } from './rate-item'

export interface RateFromBotDeps extends RateItemDeps {
  readonly actors: ActorRepository
  readonly reminders: ReminderRepository
}

/**
 * A press of 1–5 under a rating reminder (MOL-101): the very verdict «Оценки» gives, through the
 * very use case — only the owner is found by the Telegram account that pressed, which the bot took
 * from `ctx.from.id` and never from the button. An account with no owner — erased since the
 * reminder came — is not found, the same answer as an item that is not there.
 *
 * Only a score arrives, so the review stays as it was (MOL-27). A verdict that is new, or given
 * again after a withdrawal, is counted for the reminder's lever (В-4); a second press correcting the
 * first is not a second verdict.
 */
export async function rateFromBot(
  deps: RateFromBotDeps,
  itemId: string,
  { telegramUserId, score }: RateFromBot,
): Promise<void> {
  const actor = await deps.actors.byTelegramUserId(telegramUserId)
  if (!actor) throw new DomainError(ERROR.NOT_FOUND)
  const { created } = await rateItem(deps, actor.id, itemId, { score })
  if (created) await deps.reminders.countRated()
}
