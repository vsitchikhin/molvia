import type { TelegramUserId } from '@molvia/model'
import type { ErasureRepository } from '@/db/erasure-repository'

/**
 * How many of its items a door sweeps before it answers (adversarial Р5-А16): a sweep goes about 0.15 ms
 * an item, so a spammer's 32 767 held `/delete` 6.6 s against the bot's 5 s of waiting — erased, and told
 * «не получилось». A person's whole catalogue many times over, and some 0.3 s.
 */
export const DOOR_SWEEP_ITEMS = 2_000

/**
 * A person erasing themselves — from the bot's `/delete` (MOL-58) or from the settings (MOL-94),
 * one function behind both doors. Not an error when there is nothing to erase: a second press, or
 * somebody who never signed in, gets the same answer — and the bot can then say the one sentence
 * that is true in every case.
 *
 * Erasure marks the person's items, and the items nothing stands on go at once by the sweep (MOL-374,
 * owner's В-7 «а»): only this erasure's, never everybody's (review 3, №11), and at most
 * `DOOR_SWEEP_ITEMS` of them before the answer — the minute timer takes the rest. A sweep that fails is
 * the caller's to report and answers nothing: the erasure has committed, and the timer takes it all.
 */
export async function eraseMe(
  erasure: ErasureRepository,
  telegramUserId: TelegramUserId,
  sweepFailed: (error: unknown) => void,
): Promise<void> {
  const report = await erasure.erase(telegramUserId, { dryRun: false })
  await erasure.sweepReleased(report.leavingItems.slice(0, DOOR_SWEEP_ITEMS)).catch(sweepFailed)
}
