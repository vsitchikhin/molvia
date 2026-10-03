import { createHash } from 'node:crypto'
import {
  FAILURE_COUNT_NOTICES,
  FAILURE_FRAMES,
  FAILURE_FRAME_MAX,
  FAILURE_NAME_MAX,
  FAILURE_ROUTE_MAX,
} from '@molvia/model'
import type {
  BotFailure,
  FailureSource,
  FailureSummary,
  OwnerNotice,
  TelegramUserId,
} from '@molvia/model'
import type { FailureCount, FailureOccurrence, FailureRepository } from '@/db/failures-repository'

/** Where a failure happened: who reports it, and the route, handler or job it was in. */
export interface FailurePlace {
  readonly source: FailureSource
  readonly route?: string
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
  const fingerprint = createHash('sha256')
    .update([place.source, errorName, summary.code ?? '', top, route ?? ''].join('\u0000'))
    .digest('hex')
  return {
    fingerprint,
    source: place.source,
    errorName,
    ...(summary.code === undefined ? {} : { code: summary.code }),
    ...(route === undefined || route === '' ? {} : { route }),
    frames,
    build,
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
}

/** «Сбой» — `times` occurrences of one fingerprint into the table, and what the owner should hear. */
export async function recordFailure(
  { failures, owner }: FailureRecording,
  occurrence: FailureOccurrence,
  times: number,
  at: Date,
): Promise<void> {
  await failures.record(occurrence, times, at, (count) =>
    noticesFor(occurrence, count, times, owner),
  )
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
