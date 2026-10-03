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

export interface FailureRecording {
  readonly failures: FailureRepository
  /** The owner's Telegram id — `null` in every copy and in end-to-end, where nothing is queued. */
  readonly owner: TelegramUserId | null
  /** The API's build: the bot is rolled out from the same commit and has none of its own. */
  readonly build: string
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
  const fingerprint = createHash('sha256')
    .update(
      [place.source, errorName, summary.code ?? '', framePlace(frames[0] ?? ''), route ?? ''].join(
        '\u0000',
      ),
    )
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
 * What the owner hears of one more occurrence (MOL-143): the first time in a build, with the frame
 * it was thrown at (В-2), and again when it reaches 10, 100 and 1000 there (В-5) — at most four
 * messages a fingerprint a build, and none where no owner is set.
 */
export function noticesFor(
  occurrence: FailureOccurrence,
  count: FailureCount,
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
  if (count.buildCount === 1) {
    const [frame] = occurrence.frames
    return [
      {
        kind: 'failure',
        ...facts,
        ...(frame === undefined ? {} : { frame }),
        fingerprint: occurrence.fingerprint.slice(0, 6),
      },
    ]
  }
  const reached = FAILURE_COUNT_NOTICES.find((threshold) => threshold === count.buildCount)
  return reached === undefined ? [] : [{ kind: 'failure_count', ...facts, count: reached }]
}

/** «Сбой» — one occurrence into the table, and what the owner should hear of it, at once. */
export async function recordFailure(
  { failures, owner, build }: FailureRecording,
  summary: FailureSummary,
  place: FailurePlace,
  at: Date,
): Promise<void> {
  const occurrence = occurrenceOf(summary, place, build)
  await failures.record(occurrence, at, (count) => noticesFor(occurrence, count, owner))
}

/** A failure the bot reports of its own (Р-5): its handler is its place. */
export async function recordBotFailure(
  recording: FailureRecording,
  { handler, errorName, code, frames }: BotFailure,
  at: Date,
): Promise<void> {
  const summary: FailureSummary = {
    errorName,
    ...(code === undefined ? {} : { code }),
    ...(frames === undefined ? {} : { frames }),
  }
  await recordFailure(recording, summary, { source: 'bot', route: handler }, at)
}
