import {
  SILENCE_NOTICES_PER_CLAIM,
  silenceCountdown,
  silenceSendCountries,
  timeZoneOf,
} from '@molvia/model'
import type { DueSilenceNotices, SilenceNoticeToOwner } from '@molvia/model'
import type { ErasureRepository } from '@/db/erasure-repository'
import type { OwnerNoticeRepository } from '@/db/owner-notices-repository'
import type { SilenceRepository } from '@/db/silence-repository'

/** The run is once a day (Р-8): the precision of «two years» is a day, and the run's query costs nothing. */
export const SILENCE_ERASE_EVERY_MS = 24 * 60 * 60 * 1000

/** How many accounts one day's run erases; the rest go the next day. */
export const SILENCE_ERASURES_PER_RUN = 1000

/**
 * The warnings before an account is erased for two years of silence (MOL-239), marked as handed and
 * handed to the bot to send — the API decides, the bot only sends (MOL-101 Р-1). Only to people whose
 * day it is (Р-5): outside every country's day nothing is asked of the database.
 *
 * The owner hears how many (В-3 «а») — the first sign of a clock gone wrong, a month before any
 * erasure. A notice that fails to queue is reported and the warnings still go: they are marked already,
 * and lost here they would be lost for good.
 */
export async function claimSilenceNotices(
  deps: {
    readonly silence: Pick<SilenceRepository, 'claimWarnings'>
    readonly notices: Pick<OwnerNoticeRepository, 'queue'>
    readonly owner: boolean
    readonly failed: (error: unknown) => void
  },
  now: Date,
): Promise<DueSilenceNotices> {
  const countries = silenceSendCountries(now)
  if (countries.length === 0) return { notices: [] }
  const warned = await deps.silence.claimWarnings(countries, now, SILENCE_NOTICES_PER_CLAIM)
  if (warned.length === 0) return { notices: [] }
  if (deps.owner) {
    await tell(deps, now, {
      kind: 'silence',
      warned30: warned.filter(({ step }) => step === 30).length,
      warned7: warned.filter(({ step }) => step === 7).length,
      erased: 0,
      erasedBlocked: 0,
    })
  }
  return {
    notices: warned.map(({ telegramUserId, country, eraseAt }) => ({
      telegramUserId,
      // every country a warning is claimed for has a zone: it was chosen by its day
      ...silenceCountdown(eraseAt, now, timeZoneOf(country) ?? 'UTC'),
    })),
  }
}

/**
 * The day's run (Р-8): every account whose silence is over is erased by the one function of «Удалить
 * мои данные», each in a transaction of its own, the condition judged again under its locks (Р-7). One
 * that fails is reported and the rest go on; run twice, it finds nobody the second time.
 */
export async function eraseSilent(
  deps: {
    readonly silence: Pick<SilenceRepository, 'due'>
    readonly erasure: Pick<ErasureRepository, 'erase'>
    readonly notices: Pick<OwnerNoticeRepository, 'queue'>
    readonly owner: boolean
    readonly failed: (error: unknown) => void
  },
  now: Date,
): Promise<{ readonly erased: number; readonly erasedBlocked: number }> {
  let erased = 0
  let erasedBlocked = 0
  for (const { telegramUserId, blocked } of await deps.silence.due(now, SILENCE_ERASURES_PER_RUN)) {
    try {
      const report = await deps.erasure.erase(telegramUserId, { dryRun: false, silentAt: now })
      if (!report.found) continue
      erased += 1
      if (blocked) erasedBlocked += 1
    } catch (error) {
      deps.failed(error)
    }
  }
  if (deps.owner && erased > 0) {
    await tell(deps, now, { kind: 'silence', warned30: 0, warned7: 0, erased, erasedBlocked })
  }
  return { erased, erasedBlocked }
}

async function tell(
  deps: {
    readonly notices: Pick<OwnerNoticeRepository, 'queue'>
    readonly failed: (error: unknown) => void
  },
  now: Date,
  notice: SilenceNoticeToOwner,
): Promise<void> {
  try {
    await deps.notices.queue(notice, now)
  } catch (error) {
    deps.failed(error)
  }
}
