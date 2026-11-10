import type { TelegramUserId } from '@molvia/model'
import type { ErasureRepository } from '@/db/erasure-repository'

/**
 * A person erasing themselves — from the bot's `/delete` (MOL-58) or from the settings (MOL-94),
 * one function behind both doors. Not an error when there is nothing to erase: a second press, or
 * somebody who never signed in, gets the same answer — and the bot can then say the one sentence
 * that is true in every case.
 *
 * Erasure marks the person's items, and the items nothing stands on go at once by the sweep (MOL-374,
 * owner's В-7 «а»): only this erasure's, never everybody's (review 3, №11). A sweep that fails is the
 * caller's to report and answers nothing: the erasure has committed, and the minute timer takes the rest.
 */
export async function eraseMe(
  erasure: ErasureRepository,
  telegramUserId: TelegramUserId,
  sweepFailed: (error: unknown) => void,
): Promise<void> {
  const report = await erasure.erase(telegramUserId, { dryRun: false })
  await erasure.sweepReleased(report.leavingItems).catch(sweepFailed)
}
