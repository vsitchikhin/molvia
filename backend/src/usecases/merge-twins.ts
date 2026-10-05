import {
  MERGE_NOTICE_PAIRS,
  TWIN_CANDIDATE,
  mergeClock,
  nameParts,
  twinSpelling,
  twinVerdict,
} from '@molvia/model'
import type {
  CandidatePair,
  CatalogueMergedNotice,
  MergedPair,
  MergeSubject,
  TwinVerdict,
} from '@molvia/model'
import type { Spelling } from '@molvia/model'
import type { MergeRepository, PlaceRow, TwinSide } from '@/db/merge-repository'
import { pairKey } from '@/db/merge-repository'
import type { OwnerNoticeRepository } from '@/db/owner-notices-repository'
import type { Embedder } from '@/embeddings/embedder'

export interface MergeTwinsDeps {
  readonly merges: MergeRepository
  readonly embedder: Embedder
  readonly notices: Pick<OwnerNoticeRepository, 'queue'>
  /** Whether there is an owner to tell: none in a copy, and then the report is only marked. */
  readonly owner: boolean
}

/** One pair the night judged, the older side first — the one a merge keeps (Р-2). */
interface Judged {
  readonly subject: MergeSubject
  readonly from: TwinSide | PlaceRow
  readonly into: TwinSide | PlaceRow
  readonly city?: string
  readonly verdict: TwinVerdict
  readonly spelling: Spelling | null
  readonly meaning: number | null
}

/** The older of two: the one that has been there longer, the lower id of two made in one instant. */
function ordered<T extends { readonly id: string; readonly createdAt: Date }>(a: T, b: T): [T, T] {
  const older =
    a.createdAt.getTime() !== b.createdAt.getTime() ? a.createdAt < b.createdAt : a.id < b.id
  return older ? [b, a] : [a, b]
}

function judge(
  subject: MergeSubject,
  a: TwinSide | PlaceRow,
  b: TwinSide | PlaceRow,
  sameUnit: boolean,
  meaning: number | null,
  city?: string,
): Judged {
  const spelling = twinSpelling(nameParts(a.name), nameParts(b.name))
  const [from, into] = ordered(a, b)
  return {
    subject,
    from,
    into,
    ...(city === undefined ? {} : { city }),
    verdict: twinVerdict({ spelling, sameUnit, meaning }),
    spelling,
    meaning,
  }
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0
  let x = 0
  let y = 0
  for (let i = 0; i < a.length; i++) {
    const p = a[i] ?? 0
    const q = b[i] ?? 0
    dot += p * q
    x += p * p
    y += q * q
  }
  return dot / Math.sqrt(x * y)
}

/** The pairs of places of one city: by spelling first, and the model asked only for those it lets through. */
async function placePairs(groups: readonly PlaceRow[][], embedder: Embedder): Promise<Judged[]> {
  const vectors = new Map<string, readonly number[]>()
  const vector = async (name: string): Promise<readonly number[] | null> => {
    if (!embedder.ready()) return null
    const known = vectors.get(name)
    if (known) return known
    const made = await embedder.name(name)
    vectors.set(name, made)
    return made
  }
  const judged: Judged[] = []
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]
        const b = group[j]
        if (!a || !b) continue
        if (twinSpelling(nameParts(a.name), nameParts(b.name)) === null) continue
        const [x, y] = [await vector(a.name), await vector(b.name)]
        const meaning = x === null || y === null ? null : cosine(x, y)
        judged.push(judge('place', a, b, true, meaning, a.city))
      }
    }
  }
  return judged
}

/**
 * One night of the merge of twins (MOL-106): what reached a trace since is swept to its survivor, the
 * pairs near enough are merged — or only named, in `report` mode (В-3) — and the rest that are near are
 * new candidates for the owner. The report is kept with the night and handed in the morning.
 */
export async function mergeNight(
  { merges, embedder }: Pick<MergeTwinsDeps, 'merges' | 'embedder'>,
  mode: 'on' | 'report',
  day: string,
): Promise<CatalogueMergedNotice> {
  const on = mode === 'on'
  if (on) await merges.sweep()

  const items = (await merges.itemPairs(embedder.model, TWIN_CANDIDATE.meaning)).map((row) =>
    judge('item', row.a, row.b, row.a.unit === row.b.unit, row.meaning),
  )
  const places = await placePairs(await merges.placeGroups(), embedder)
  const undone = {
    item: await merges.undonePairs('item'),
    place: await merges.undonePairs('place'),
  }

  const merged: MergedPair[] = []
  const candidates: Judged[] = []
  // A side merged tonight is a trace now: a later pair naming it waits for the next night.
  const gone = new Set<string>()
  for (const pair of [...items, ...places]) {
    if (pair.verdict === 'apart' || undone[pair.subject].has(pairKey(pair.from.id, pair.into.id))) {
      continue
    }
    if (pair.verdict === 'candidate') {
      candidates.push(pair)
      continue
    }
    if (gone.has(pair.from.id) || gone.has(pair.into.id)) continue
    const named: MergedPair = {
      subject: pair.subject,
      from: pair.from.name,
      into: pair.into.name,
      ...(pair.city === undefined ? {} : { city: pair.city }),
    }
    if (!on) {
      gone.add(pair.from.id)
      merged.push(named)
      continue
    }
    const how = {
      by: 'night' as const,
      ...(pair.spelling === null ? {} : { edits: pair.spelling.edits, worst: pair.spelling.worst }),
      ...(pair.meaning === null ? {} : { meaning: pair.meaning }),
    }
    const outcome =
      pair.subject === 'item'
        ? await merges.mergeItems(pair.from.id, pair.into.id, how)
        : await merges.mergePlaces(pair.from.id, pair.into.id, how)
    if ('id' in outcome) {
      gone.add(pair.from.id)
      merged.push({ ...named, id: outcome.id })
    } else if (outcome.refused === 'barcodes') {
      // Too many codes for one item: the owner decides.
      candidates.push(pair)
    }
  }

  const fresh: CandidatePair[] = []
  for (const subject of ['item', 'place'] as const) {
    const ofSubject = candidates.filter((pair) => pair.subject === subject)
    const first = await merges.firstNamed(
      subject,
      ofSubject.map((pair) => [pair.from.id, pair.into.id] as const),
      day,
    )
    for (const pair of ofSubject) {
      if (!first.has(pairKey(pair.from.id, pair.into.id))) continue
      fresh.push({
        subject,
        from: pair.from.name,
        into: pair.into.name,
        fromId: pair.from.id,
        intoId: pair.into.id,
        ...(pair.city === undefined ? {} : { city: pair.city }),
      })
    }
  }

  return {
    kind: 'catalogue_merged',
    day,
    mode,
    merged: merged.length,
    candidates: fresh.length,
    mergedPairs: merged.slice(0, MERGE_NOTICE_PAIRS),
    candidatePairs: fresh.slice(0, MERGE_NOTICE_PAIRS),
  }
}

/**
 * The minute timer's step (MOL-106, Т-9): from half past four in Yerevan, the night — once, by the
 * instance that claims its day; from nine, its report to the owner. A night the API slept through runs
 * when it wakes, the same day.
 */
export async function mergeTick(
  deps: MergeTwinsDeps,
  mode: 'on' | 'report' | 'off',
  now: Date,
): Promise<void> {
  if (mode === 'off') return
  const clock = mergeClock(now)
  if (clock.merge && (await deps.merges.claimRun(clock.day, mode, now))) {
    const report = await mergeNight(deps, mode, clock.day)
    await deps.merges.finishRun(clock.day, report, new Date())
  }
  if (clock.report) {
    const report = await deps.merges.takeReport(clock.day, now)
    if (report !== null && deps.owner) await deps.notices.queue(report, now)
  }
}
