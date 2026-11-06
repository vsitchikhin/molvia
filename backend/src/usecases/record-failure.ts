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
import { addressMinute, monotonic } from './address-minute'
import type { AddressMinute } from './address-minute'

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
 * notices and new rows, and nothing else: it is in no row and no notice. Answers whether the
 * occurrence was written: a phone's new fingerprint past the hour's new rows is not (review №6).
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
  const place = phone && phoneRows !== undefined ? phoneRows.claim(sender) : undefined
  const fresh = place !== null
  let count: FailureCount | null
  // What of the hour's notices this write took, and how many it held back: the budget is asked
  // inside its transaction, and the held ones are counted only once it has committed.
  let giveBackNotices: () => void = () => undefined
  let held = 0
  try {
    count = await failures.record(
      occurrence,
      times,
      at,
      (written) => {
        const notices = noticesFor(occurrence, written, times, owner)
        if (!phone || phoneNotices === undefined) return notices
        const asked = phoneNotices.ask(notices, sender)
        giveBackNotices = asked.giveBack
        held = asked.held
        return asked.told
      },
      { fresh },
    )
  } catch (error) {
    // A write that failed — the database down — wrote no row: its place goes back, or every report
    // of the outage held one for the hour (review №9) — and so do the notices it took, if the
    // transaction failed after the budget gave them (round 5). The ones it held back were never
    // counted: «скрыто» is of failures in the table (adversarial Е1 of round 6, Ж1 of round 7).
    place?.()
    giveBackNotices()
    throw error
  }
  // Held back, and written: now it is «скрыто». Counted after the commit, so the minute timer
  // never tells of a write still in flight that then fails (adversarial Ж1).
  if (held > 0) phoneNotices?.hold(held)
  // Not a new row after all — its count is more than what was written now: the place goes back.
  if (count !== null && count.count !== times) place?.()
  // A new fingerprint past the hour's rows: not in the table, so the summary says so (round 3, В1).
  if (count === null) phoneNotices?.unwritten()
  return count !== null
}

/** How many notices about the phone's failures the owner hears in an hour (MOL-144, review №1). */
export const PHONE_NOTICES_PER_HOUR = 20
/** And how many of them one sender's reports may bring (adversarial Б1 of round 2). */
export const PHONE_NOTICES_PER_SENDER = 3
const HOUR_MS = 60 * 60 * 1000
/** A place in an hour, by the clock that never steps back; given back as itself (MOL-359, Б1). */
interface Moment {
  readonly at: number
}
const withinHour = (moments: readonly Moment[], now: number) =>
  moments.filter((moment) => now - moment.at < HOUR_MS)

export interface PhoneNoticeBudget {
  /**
   * What of the phone's notices fits the hour — the sender's and everybody's — and how many did not:
   * those are not counted yet (`hold`). `giveBack` returns exactly the places these took, for a write
   * that then failed (MOL-359, Б1).
   */
  ask(
    notices: readonly OwnerNotice[],
    sender?: string,
  ): { readonly told: OwnerNotice[]; readonly held: number; readonly giveBack: () => void }
  /** Counts `count` notices held back of a failure written: «скрыто». */
  hold(count: number): void
  /** `ask` and `hold` at once, for a failure already in the table. */
  take(notices: readonly OwnerNotice[], sender?: string): OwnerNotice[]
  /** A new fingerprint of the phone the hour's rows had no room for: not in the table at all. */
  unwritten(): void
  /** Lets go of every sender with nothing in the hour before now (MOL-241). */
  forget(): void
  /** How many were held back and how many not written, at most once an hour. */
  held(): OwnerNotice | null
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
 * restart. A sender is let go an hour after its last notice by `forget`, on a minute timer that waits
 * on no database (MOL-241).
 */
export function phoneNoticeBudget(
  perHour = PHONE_NOTICES_PER_HOUR,
  perSender = PHONE_NOTICES_PER_SENDER,
  /** The notice of what was held back: the phone's, or another channel's by the same rule (MOL-309). */
  mutedOf: (count: number, unwritten: number) => OwnerNotice = (count, unwritten) => ({
    kind: 'failure_muted',
    source: 'phone',
    count,
    ...(unwritten > 0 ? { unwritten } : {}),
  }),
  clock: () => number = monotonic,
): PhoneNoticeBudget {
  let told: Moment[] = []
  const bySender = new Map<string, Moment[]>()
  let muted = 0
  let lost = 0
  let lastHeld: number | undefined

  return {
    ask(notices, sender) {
      const now = clock()
      told = withinHour(told, now)
      const theirs = sender === undefined ? [] : withinHour(bySender.get(sender) ?? [], now)
      const out: OwnerNotice[] = []
      const taken: Moment[] = []
      let kept = 0
      for (const notice of notices) {
        if (told.length >= perHour || theirs.length >= perSender) {
          kept += 1
          continue
        }
        const moment = { at: now }
        told.push(moment)
        theirs.push(moment)
        taken.push(moment)
        out.push(notice)
      }
      if (sender !== undefined) bySender.set(sender, theirs)
      const giveBack = () => {
        told = told.filter((moment) => !taken.includes(moment))
        const mine = sender === undefined ? undefined : bySender.get(sender)
        if (sender !== undefined && mine !== undefined) {
          bySender.set(
            sender,
            mine.filter((moment) => !taken.includes(moment)),
          )
        }
      }
      return { told: out, held: kept, giveBack }
    },
    hold(count) {
      muted += count
    },
    take(notices, sender) {
      const asked = this.ask(notices, sender)
      this.hold(asked.held)
      return asked.told
    },
    unwritten() {
      lost += 1
    },
    forget() {
      const now = clock()
      told = withinHour(told, now)
      for (const [sender, moments] of bySender) {
        if (withinHour(moments, now).length === 0) bySender.delete(sender)
      }
    },
    held() {
      const now = clock()
      if (muted === 0 && lost === 0) return null
      if (lastHeld !== undefined && now - lastHeld < HOUR_MS) return null
      lastHeld = now
      const notice = mutedOf(muted, lost)
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
  /**
   * Takes a place for a new row, if the hour has one for the sender and for everybody, and hands back
   * how to give exactly it back (MOL-359, Б1) — for a row that was there already, or a write that failed.
   */
  claim(sender?: string): (() => void) | null
  /** Lets go of every sender with nothing in the hour before now (MOL-241). */
  forget(): void
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
 * a mark of the device, which is tracking. **A sender is let go an hour after its last failure** by
 * `forget`, on the minute timer (MOL-241): `claim` is asked of every failure of a phone, a known one
 * too, and before it every address that ever sent one stayed in memory until a restart.
 */
export function phoneRowBudget(
  perHour = PHONE_ROWS_PER_HOUR,
  perSender = PHONE_ROWS_PER_SENDER,
  clock: () => number = monotonic,
): PhoneRowBudget {
  let added: Moment[] = []
  const bySender = new Map<string, Moment[]>()
  return {
    claim(sender) {
      const now = clock()
      added = withinHour(added, now)
      const theirs = sender === undefined ? [] : withinHour(bySender.get(sender) ?? [], now)
      if (added.length >= perHour || theirs.length >= perSender) {
        if (sender !== undefined) bySender.set(sender, theirs)
        return null
      }
      const moment = { at: now }
      added.push(moment)
      if (sender !== undefined) bySender.set(sender, [...theirs, moment])
      return () => {
        added = added.filter((kept) => kept !== moment)
        const mine = sender === undefined ? undefined : bySender.get(sender)
        if (sender !== undefined && mine !== undefined) {
          bySender.set(
            sender,
            mine.filter((kept) => kept !== moment),
          )
        }
      }
    },
    forget() {
      const now = clock()
      added = withinHour(added, now)
      for (const [sender, moments] of bySender) {
        if (withinHour(moments, now).length === 0) bySender.delete(sender)
      }
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
/** The route's minute of the phone's reports (MOL-144, Р-6): the shared counter, by these numbers. */
export function phoneReportLimit(
  perAddress = PHONE_REPORTS_PER_ADDRESS,
  perMinute = PHONE_REPORTS_PER_MINUTE,
): AddressMinute {
  return addressMinute(perAddress, perMinute)
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
    readonly limit: (address: string, count: number) => boolean
    readonly take: (
      summary: FailureSummary,
      place: FailurePlace,
      build: string,
      sender: string,
    ) => void
  },
  { reports }: ClientErrors,
  address: string,
): void {
  if (!limit(address, reports.length)) throw new DomainError(ERROR.CLIENT_ERRORS_RATE_LIMITED)
  for (const report of reports) {
    const { summary, place, build } = phoneFailure(report)
    take(summary, place, build, address)
  }
}
