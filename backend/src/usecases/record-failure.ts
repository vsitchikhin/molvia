import { createHash } from 'node:crypto'
import {
  DomainError,
  ERROR,
  FAILURE_COUNT_NOTICES,
  FAILURE_FRAMES,
  FAILURE_FRAME_MAX,
  FAILURE_NAME_MAX,
  FAILURE_ROUTE_MAX,
} from '@molvia/model'
import type {
  BotFailure,
  ClientErrors,
  FailureSource,
  FailureSummary,
  OwnerNotice,
  PhoneFailure,
  TelegramUserId,
} from '@molvia/model'
import type { FailureCount, FailureOccurrence, FailureRepository } from '@/db/failures-repository'

/** Where a failure happened: who reports it, and the route, handler or job it was in. */
export interface FailurePlace {
  readonly source: FailureSource
  readonly route?: string
  /** The phone's platform, `ios 18 app` (MOL-144, В-2); none for the API and the bot. */
  readonly platform?: string
}

/**
 * A frame without its position (MOL-143, Р-2): `at rateItem (src/x.ts:42:7)` is `at rateItem
 * (src/x.ts)`. The API ships as one bundled file, so the line of a frame moves with every build —
 * kept, each rollout would make every failure new.
 */
export function framePlace(frame: string): string {
  return frame.replace(/:\d+(?::\d+)?(?=\)?$)/, '')
}

/** A kind brought to the shape the table keeps: a class name, never a sentence. */
function nameOf(errorName: string): string {
  const name = errorName.replace(/[^\w$.-]/g, '_').slice(0, FAILURE_NAME_MAX)
  return name === '' ? 'unknown' : name
}

/**
 * What is kept of a failure, and its fingerprint: the source, the kind, the code, the top frame
 * without its position and the place, hashed together. The frames themselves are kept whole — the
 * owner reads where it was — cut to the table's limits.
 */
export function occurrenceOf(
  summary: FailureSummary,
  place: FailurePlace,
  build: string,
): FailureOccurrence {
  const errorName = nameOf(summary.errorName)
  const frames = (summary.frames ?? [])
    .slice(0, FAILURE_FRAMES)
    .map((frame) => frame.slice(0, FAILURE_FRAME_MAX))
  const route = place.route?.slice(0, FAILURE_ROUTE_MAX)
  // The top frame as it came, before the cut: cut at 300 first, a frame could lose half its
  // `:line:column` and keep the rest, and every rollout would make its failure new (adversarial А6).
  const top = framePlace(summary.frames?.[0] ?? '')
  const parts = [place.source, errorName, summary.code ?? '', top, route ?? '']
  // The phone's system, not its version or mode: «only on iOS» is seen at once (MOL-144, В-2) — and
  // its build: a phone's fingerprint lives within a build (Р-10), and one row shared by an old page
  // and a new one during a rollout was «new in this build» at every turn (review №1). Left out where
  // there is no platform, so no fingerprint of the API or the bot moved.
  if (place.platform !== undefined) parts.push(place.platform.split(' ')[0] ?? '', build)
  const fingerprint = createHash('sha256').update(parts.join('\u0000')).digest('hex')
  return {
    fingerprint,
    source: place.source,
    errorName,
    ...(summary.code === undefined ? {} : { code: summary.code }),
    ...(route === undefined || route === '' ? {} : { route }),
    frames,
    build,
    ...(place.platform === undefined ? {} : { platform: place.platform }),
  }
}

/**
 * What the owner hears of `times` more occurrences written at once (MOL-143): the first time in a
 * build, with the frame it was thrown at (В-2), and when the count there crosses 10, 100 or 1000
 * (В-5) — crosses, not equals: a burst is written as one row of `times`, and 3 → 150 has passed both
 * 10 and 100, of which the owner hears the larger. None where no owner is set.
 */
export function noticesFor(
  occurrence: FailureOccurrence,
  count: FailureCount,
  times: number,
  owner: TelegramUserId | null,
): OwnerNotice[] {
  if (owner === null) return []
  const facts = {
    source: occurrence.source,
    errorName: occurrence.errorName,
    ...(occurrence.code === undefined ? {} : { code: occurrence.code }),
    ...(occurrence.route === undefined ? {} : { route: occurrence.route }),
    build: occurrence.build,
    ...(occurrence.platform === undefined ? {} : { platform: occurrence.platform }),
  }
  const notices: OwnerNotice[] = []
  const before = count.buildCount - times
  if (before <= 0) {
    const [frame] = occurrence.frames
    notices.push({
      kind: 'failure',
      ...facts,
      ...(frame === undefined ? {} : { frame }),
      fingerprint: occurrence.fingerprint.slice(0, 6),
    })
  }
  const crossed = FAILURE_COUNT_NOTICES.filter(
    (threshold) => before < threshold && threshold <= count.buildCount,
  ).at(-1)
  if (crossed !== undefined) notices.push({ kind: 'failure_count', ...facts, count: crossed })
  return notices
}

export interface FailureRecording {
  readonly failures: FailureRepository
  /** The owner's Telegram id — `null` in every copy and in end-to-end, where nothing is queued. */
  readonly owner: TelegramUserId | null
  /** What of the phone's notices the owner hears; all of them where none is given. */
  readonly phoneNotices?: PhoneNoticeBudget
}

/** «Сбой» — `times` occurrences of one fingerprint into the table, and what the owner should hear. */
export async function recordFailure(
  { failures, owner, phoneNotices }: FailureRecording,
  occurrence: FailureOccurrence,
  times: number,
  at: Date,
): Promise<void> {
  await failures.record(occurrence, times, at, (count) => {
    const notices = noticesFor(occurrence, count, times, owner)
    return occurrence.source === 'phone' && phoneNotices ? phoneNotices(notices, at) : notices
  })
}

/** How many notices about the phone's failures the owner hears in an hour (MOL-144, review №1). */
export const PHONE_NOTICES_PER_HOUR = 10
const HOUR_MS = 60 * 60 * 1000

/** Lets through what of the phone's notices fits the hour, and says how many it held back. */
export type PhoneNoticeBudget = (notices: readonly OwnerNotice[], at: Date) => OwnerNotice[]

/**
 * The phone's notices, at most `PHONE_NOTICES_PER_HOUR` an hour (review №1, adversarial А5). The
 * endpoint is open with no session and a build is the phone's word, so anyone could make every report
 * «new in this build» — twenty messages a minute in the owner's chat, the API's own drowned behind
 * them. Past the hour's ten a notice is held back and counted, never queued, and the next one let
 * through says how many were (`muted`): «и ещё M — make failures». The table counts all of them. In the
 * process's memory: a restart starts the hour over, and the API's and the bot's notices are not
 * touched.
 */
export function phoneNoticeBudget(perHour = PHONE_NOTICES_PER_HOUR): PhoneNoticeBudget {
  let told: number[] = []
  let muted = 0
  return (notices, at) => {
    const now = at.getTime()
    told = told.filter((moment) => now - moment < HOUR_MS)
    const out: OwnerNotice[] = []
    for (const notice of notices) {
      if (told.length >= perHour) {
        muted += 1
        continue
      }
      told.push(now)
      out.push(muted > 0 ? { ...notice, muted } : notice)
      muted = 0
    }
    return out
  }
}

/** A failure the bot reports of its own (Р-5): its summary, and its handler as its place. */
export function botFailure({ handler, errorName, code, frames }: BotFailure): {
  readonly summary: FailureSummary
  readonly place: FailurePlace
} {
  return {
    summary: {
      errorName,
      ...(code === undefined ? {} : { code }),
      ...(frames === undefined ? {} : { frames }),
    },
    place: { source: 'bot', route: handler },
  }
}

/**
 * A failure the phone reports of its own (MOL-144): its summary, its place — where it was caught and
 * on which screen, `screen:advice` (Р-3) — with the platform, and the build it names, which is the
 * page's and not the API's (В-1).
 */
export function phoneFailure({
  errorName,
  code,
  frames,
  catcher,
  screen,
  build,
  platform,
}: PhoneFailure): {
  readonly summary: FailureSummary
  readonly place: FailurePlace
  readonly build: string
} {
  return {
    summary: {
      errorName,
      ...(code === undefined ? {} : { code }),
      ...(frames === undefined ? {} : { frames }),
    },
    place: { source: 'phone', route: `${catcher}:${screen}`, platform },
    build,
  }
}

/**
 * The phone's reports an address may send in a minute (MOL-144, Р-6): three whole buffers. One was
 * too few for a mobile operator's address, which thousands of phones share (adversarial А6) — and a
 * phone told «too many» keeps its buffer for later now (review №2).
 */
export const PHONE_REPORTS_PER_ADDRESS = 60
/** The phone's reports everybody together may send in a minute. */
export const PHONE_REPORTS_PER_MINUTE = 200
const MINUTE_MS = 60 * 1000

/**
 * Whether `count` more reports from `address` fit the minute (MOL-144, Р-6), and if they do, counted.
 * In the process's memory, for a minute, and nowhere else: the address is the limit's key and never
 * written down — no log, no table. What was refused is not counted, so the memory holds at most the
 * minute's `PHONE_REPORTS_PER_MINUTE`.
 */
export type PhoneReportLimit = (address: string, count: number, now: number) => boolean

export function phoneReportLimit(
  perAddress = PHONE_REPORTS_PER_ADDRESS,
  perMinute = PHONE_REPORTS_PER_MINUTE,
): PhoneReportLimit {
  let taken: { readonly address: string; readonly at: number; readonly count: number }[] = []
  return (address, count, now) => {
    taken = taken.filter((entry) => now - entry.at < MINUTE_MS)
    const sum = (entries: typeof taken) => entries.reduce((total, entry) => total + entry.count, 0)
    const mine = sum(taken.filter((entry) => entry.address === address))
    if (mine + count > perAddress || sum(taken) + count > perMinute) return false
    taken.push({ address, at: now, count })
    return true
  }
}

/**
 * «Сбой телефона» — `POST /client-errors` (MOL-144): within the limit every report goes to the table
 * through `take`, which is not waited on; past it the whole body is refused, and the phone forgets it.
 */
export function takePhoneFailures(
  {
    limit,
    take,
  }: {
    readonly limit: PhoneReportLimit
    readonly take: (summary: FailureSummary, place: FailurePlace, build: string) => void
  },
  { reports }: ClientErrors,
  address: string,
  now: number,
): void {
  if (!limit(address, reports.length, now)) throw new DomainError(ERROR.CLIENT_ERRORS_RATE_LIMITED)
  for (const report of reports) {
    const { summary, place, build } = phoneFailure(report)
    take(summary, place, build)
  }
}
