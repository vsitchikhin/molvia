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
  /** How many new rows the phone may add in an hour; any number where none is given. */
  readonly phoneRows?: PhoneRowBudget
}

/**
 * «Сбой» — `times` occurrences of one fingerprint into the table, and what the owner should hear.
 * `sender` is whose report it was — the phone's network, the key of the limit — for the hour of its
 * notices, and nothing else: it is in no row and no notice. Answers whether the occurrence was
 * written: a phone's new fingerprint past the hour's new rows is not (review №6).
 */
export async function recordFailure(
  { failures, owner, phoneNotices, phoneRows }: FailureRecording,
  occurrence: FailureOccurrence,
  times: number,
  at: Date,
  sender?: string,
): Promise<boolean> {
  const phone = occurrence.source === 'phone'
  // Taken before the write, given back if the row was there: four writes run at once, and each
  // asking first and taking after let the hour's rows run past by three.
  const claimed = phone && phoneRows !== undefined
  const fresh = !claimed || phoneRows.claim(at, sender)
  let count: FailureCount | null
  // What of the hour's notices this write took: the budget is spent inside its transaction.
  let told: readonly OwnerNotice[] = []
  try {
    count = await failures.record(
      occurrence,
      times,
      at,
      (written) => {
        const notices = noticesFor(occurrence, written, times, owner)
        if (!phone || phoneNotices === undefined) return notices
        told = phoneNotices.take(notices, at, sender)
        return told
      },
      { fresh },
    )
  } catch (error) {
    // A write that failed — the database down — wrote no row: its place goes back, or every report
    // of the outage held one for the hour (review №9) — and so do the notices it took, if the
    // transaction failed after the budget gave them (round 5).
    if (claimed && fresh) phoneRows.refund(at, sender)
    if (told.length > 0) phoneNotices?.refund(told.length, at, sender)
    throw error
  }
  // Not a new row after all — its count is more than what was written now: the place goes back.
  if (phone && fresh && count !== null && count.count !== times) phoneRows?.refund(at, sender)
  // A new fingerprint past the hour's rows: not in the table, so the summary says so (round 3, В1).
  if (count === null) phoneNotices?.unwritten()
  return count !== null
}

/** How many notices about the phone's failures the owner hears in an hour (MOL-144, review №1). */
export const PHONE_NOTICES_PER_HOUR = 20
/** And how many of them one sender's reports may bring (adversarial Б1 of round 2). */
export const PHONE_NOTICES_PER_SENDER = 3
const HOUR_MS = 60 * 60 * 1000

export interface PhoneNoticeBudget {
  /** What of the phone's notices fits the hour — the sender's and everybody's. */
  take(notices: readonly OwnerNotice[], at: Date, sender?: string): OwnerNotice[]
  /** Gives back `count` notices taken at `at` by a write that then failed. */
  refund(count: number, at: Date, sender?: string): void
  /** A new fingerprint of the phone the hour's rows had no room for: not in the table at all. */
  unwritten(): void
  /** How many were held back and how many not written, at most once an hour. */
  held(at: Date): OwnerNotice | null
}

/**
 * The phone's notices (review №1, adversarial А5, Б1): at most `PHONE_NOTICES_PER_SENDER` an hour
 * from one sender and `PHONE_NOTICES_PER_HOUR` from everybody. The endpoint is open with no session
 * and a build is the phone's word, so anyone could make every report «new in this build» — twenty
 * messages a minute in the owner's chat, the API's own drowned behind them. A cap shared by everybody
 * alone was spent by ten invented reports at the start of an hour, and a real failure after the
 * rollout was told to nobody; a sender's own three leave the rest to the others. **What is held back
 * is counted, never queued, and told by the minute timer** (`held`, review №7): «скрыто M — make
 * failures», not with the next failure, which may never come — **at most once an hour and past the
 * hour's twenty** (adversarial В2 of round 3): a cap kept full by seven networks would otherwise never
 * have room for it. It says, too, how many new fingerprints the hour's rows had no room for. **The
 * price, named:** seven networks — seven IPv4 addresses, seven `/48` — silence the names of the
 * phone's new failures for an hour; the table keeps them and the owner hears «скрыто M» every hour.
 * In the process's memory: a restart starts the hour over and forgets what was held — a rollout is a
 * restart.
 */
export function phoneNoticeBudget(
  perHour = PHONE_NOTICES_PER_HOUR,
  perSender = PHONE_NOTICES_PER_SENDER,
): PhoneNoticeBudget {
  let told: number[] = []
  const bySender = new Map<string, number[]>()
  let muted = 0
  let lost = 0
  let lastHeld: number | undefined
  const recent = (moments: readonly number[], now: number) =>
    moments.filter((moment) => now - moment < HOUR_MS)

  return {
    take(notices, at, sender) {
      const now = at.getTime()
      told = recent(told, now)
      const theirs = sender === undefined ? [] : recent(bySender.get(sender) ?? [], now)
      const out: OwnerNotice[] = []
      for (const notice of notices) {
        if (told.length >= perHour || theirs.length >= perSender) {
          muted += 1
          continue
        }
        told.push(now)
        theirs.push(now)
        out.push(notice)
      }
      if (sender !== undefined) bySender.set(sender, theirs)
      return out
    },
    refund(count, at, sender) {
      const now = at.getTime()
      for (let index = 0; index < count; index += 1) {
        const mine = told.lastIndexOf(now)
        if (mine >= 0) told.splice(mine, 1)
        const theirs = sender === undefined ? undefined : bySender.get(sender)
        const position = theirs?.lastIndexOf(now) ?? -1
        if (position >= 0) theirs?.splice(position, 1)
      }
    },
    unwritten() {
      lost += 1
    },
    held(at) {
      const now = at.getTime()
      told = recent(told, now)
      for (const [sender, moments] of bySender) {
        if (recent(moments, now).length === 0) bySender.delete(sender)
      }
      if (muted === 0 && lost === 0) return null
      if (lastHeld !== undefined && now - lastHeld < HOUR_MS) return null
      lastHeld = now
      const notice: OwnerNotice = {
        kind: 'failure_muted',
        source: 'phone',
        count: muted,
        ...(lost > 0 ? { unwritten: lost } : {}),
      }
      muted = 0
      lost = 0
      return notice
    },
  }
}

/** How many new rows the phone's reports may add to the table in an hour (review №6, №8). */
export const PHONE_ROWS_PER_HOUR = 1000
/**
 * And how many of them one sender may add (review №8, adversarial В1 of round 3): a minute of its
 * limit. Ten were too few for a mobile operator's address, which thousands of phones share — one
 * failure of a rollout is a dozen fingerprints, its screens times its systems (adversarial Г1).
 */
export const PHONE_ROWS_PER_SENDER = 60

export interface PhoneRowBudget {
  /** Takes a place for a new row, if the hour has one for the sender and for everybody. */
  claim(at: Date, sender?: string): boolean
  /** Gives back a place taken at `at` for a row that was there already. */
  refund(at: Date, sender?: string): void
}

/**
 * The phone's new fingerprints (review №6, №8): at most `PHONE_ROWS_PER_SENDER` an hour from one
 * sender and `PHONE_ROWS_PER_HOUR` from everybody. A fingerprint is all the phone's words — the kind,
 * the frames, the build — so every invented report could be a new row, two hundred a minute kept
 * thirty days and copied every night. Past the budget a known fingerprint still counts and a new one
 * is not written, and the hour's summary says how many. A cap shared by everybody alone was spent by
 * two addresses in two minutes, and every real new failure after a rollout was written nowhere for the
 * hour (adversarial В1); a sender's sixty leave the rest to the others. **The prices, named:**
 * seventeen networks fill the hour, some 720 000 rows in thirty days at most; and the sender is an
 * address, so one subscriber of a mobile operator sending sixty invented reports an hour takes the
 * new rows of every phone behind the same address (adversarial Г1) — telling phones apart would need
 * a mark of the device, which is tracking.
 */
export function phoneRowBudget(
  perHour = PHONE_ROWS_PER_HOUR,
  perSender = PHONE_ROWS_PER_SENDER,
): PhoneRowBudget {
  let added: number[] = []
  const bySender = new Map<string, number[]>()
  const recent = (moments: readonly number[], now: number) =>
    moments.filter((moment) => now - moment < HOUR_MS)
  const without = (moments: readonly number[], moment: number) => {
    const index = moments.lastIndexOf(moment)
    return index < 0 ? [...moments] : [...moments.slice(0, index), ...moments.slice(index + 1)]
  }
  return {
    claim(at, sender) {
      const now = at.getTime()
      added = recent(added, now)
      const theirs = sender === undefined ? [] : recent(bySender.get(sender) ?? [], now)
      if (added.length >= perHour || theirs.length >= perSender) {
        if (sender !== undefined) bySender.set(sender, theirs)
        return false
      }
      added.push(now)
      if (sender !== undefined) bySender.set(sender, [...theirs, now])
      return true
    },
    refund(at, sender) {
      const now = at.getTime()
      added = without(added, now)
      if (sender !== undefined) bySender.set(sender, without(bySender.get(sender) ?? [], now))
    },
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
    readonly take: (
      summary: FailureSummary,
      place: FailurePlace,
      build: string,
      sender: string,
    ) => void
  },
  { reports }: ClientErrors,
  address: string,
  now: number,
): void {
  if (!limit(address, reports.length, now)) throw new DomainError(ERROR.CLIENT_ERRORS_RATE_LIMITED)
  for (const report of reports) {
    const { summary, place, build } = phoneFailure(report)
    take(summary, place, build, address)
  }
}
