import type { TelegramUserId } from '@molvia/model'
import type { ErasureRepository } from '@/db/erasure-repository'

/**
 * A person erasing themselves — from the bot's `/delete` (MOL-58) or from the settings (MOL-94),
 * one function behind both doors. Not an error when there is nothing to erase: a second press, or
 * somebody who never signed in, gets the same answer — and the bot can then say the one sentence
 * that is true in every case.
 */
export async function eraseMe(
  erasure: ErasureRepository,
  telegramUserId: TelegramUserId,
): Promise<void> {
  await erasure.erase(telegramUserId, { dryRun: false })
}
