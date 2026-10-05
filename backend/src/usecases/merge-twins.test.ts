import { describe, expect, it } from 'vitest'
import { MERGE_NOTICE_PAIRS } from '@molvia/model'
import type { CatalogueMergedNotice, OwnerNotice } from '@molvia/model'
import type {
  MergeHow,
  MergeOutcome,
  MergeRepository,
  PlaceRow,
  TwinRow,
} from '@/db/merge-repository'
import { pairKey } from '@/db/merge-repository'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { mergeNight, mergeTick } from './merge-twins'

const side = (id: string, name: string, day: string, unit = 'l') => ({
  id,
  name,
  unit,
  createdAt: new Date(`${day}T10:00:00Z`),
})

const MILK = side('a1', 'Молоко 3,2%', '2026-09-01')
const MILK_POINT = side('a2', 'Молоко 3.2%', '2026-09-03')
const MALOKO = side('a3', 'Малоко 3,2%', '2026-09-04')

function world({
  pairs = [] as TwinRow[],
  groups = [] as PlaceRow[][],
  undone = [] as string[],
  named = [] as string[],
  refuse = null as MergeOutcome | null,
  claimed = false,
} = {}) {
  const merged: [string, string, MergeHow][] = []
  const runs = new Map<string, CatalogueMergedNotice | null>()
  const queued: OwnerNotice[] = []
  const reported = new Set<string>()
  let sweeps = 0
  const names = new Set(named)
  let next = 1
  const merges: MergeRepository = {
    mergeItems: (from, into, how) => {
      merged.push([from, into, how])
      return Promise.resolve(refuse ?? { id: next++ })
    },
    mergePlaces: (from, into, how) => {
      merged.push([from, into, how])
      return Promise.resolve(refuse ?? { id: next++ })
    },
    unmerge: () => Promise.reject(new Error('not here')),
    sweep: () => {
      sweeps += 1
      return Promise.resolve(0)
    },
    itemPairs: () => Promise.resolve(pairs),
    placeGroups: () => Promise.resolve(groups),
    undonePairs: () => Promise.resolve(new Set(undone)),
    firstNamed: (_subject, list) => {
      const fresh = list.map(([a, b]) => pairKey(a, b)).filter((key) => !names.has(key))
      for (const key of fresh) names.add(key)
      return Promise.resolve(new Set(fresh))
    },
    claimRun: (day) => {
      if (claimed || runs.has(day)) return Promise.resolve(false)
      runs.set(day, null)
      return Promise.resolve(true)
    },
    finishRun: (day, report) => {
      runs.set(day, report)
      return Promise.resolve()
    },
    takeReport: (day) => {
      if (reported.has(day)) return Promise.resolve(null)
      const report = runs.get(day) ?? null
      if (report !== null) reported.add(day)
      return Promise.resolve(report)
    },
  }
  const notices = {
    queue: (notice: OwnerNotice) => {
      queued.push(notice)
      return Promise.resolve()
    },
  }
  return {
    merges,
    notices,
    merged,
    queued,
    runs,
    sweeps: () => sweeps,
  }
}

describe('mergeNight', () => {
  it('merges the younger into the older, and names each merge by its number', async () => {
    const w = world({ pairs: [{ a: MILK_POINT, b: MILK, meaning: 0.97 }] })
    const report = await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-06')
    expect(w.merged).toEqual([['a2', 'a1', { by: 'night', edits: 0, worst: 0, meaning: 0.97 }]])
    expect(report).toEqual({
      kind: 'catalogue_merged',
      day: '2026-10-06',
      mode: 'on',
      merged: 1,
      candidates: 0,
      mergedPairs: [{ subject: 'item', from: 'Молоко 3.2%', into: 'Молоко 3,2%', id: 1 }],
      candidatePairs: [],
    })
    expect(w.sweeps()).toBe(1)
  })

  it('merges nothing in the report mode, and says what it would', async () => {
    const w = world({ pairs: [{ a: MILK, b: MILK_POINT, meaning: 0.97 }] })
    const report = await mergeNight(
      { merges: w.merges, embedder: NO_EMBEDDER },
      'report',
      '2026-10-06',
    )
    expect(w.merged).toEqual([])
    expect(w.sweeps()).toBe(0)
    expect(report.mergedPairs).toEqual([
      { subject: 'item', from: 'Молоко 3.2%', into: 'Молоко 3,2%' },
    ])
  })

  it('leaves a side merged tonight for the next night', async () => {
    const w = world({
      pairs: [
        { a: MILK, b: MILK_POINT, meaning: 0.97 },
        { a: MILK_POINT, b: MALOKO, meaning: 0.95 },
      ],
    })
    await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-06')
    expect(w.merged.map(([from, into]) => [from, into])).toEqual([['a2', 'a1']])
  })

  it('never touches a pair undone before', async () => {
    const w = world({
      pairs: [{ a: MILK, b: MILK_POINT, meaning: 0.97 }],
      undone: [pairKey('a1', 'a2')],
    })
    const report = await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-06')
    expect([w.merged, report.merged, report.candidates]).toEqual([[], 0, 0])
  })

  it('names a candidate once, the first morning only', async () => {
    const pair = {
      a: side('b1', 'Milo', '2026-09-01'),
      b: side('b2', 'Мыло', '2026-09-02'),
      meaning: 0.48,
    }
    const w = world({ pairs: [pair] })
    const first = await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-06')
    expect(first.candidatePairs).toEqual([
      { subject: 'item', from: 'Мыло', into: 'Milo', fromId: 'b2', intoId: 'b1' },
    ])
    const second = await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-07')
    expect([second.candidates, w.merged]).toEqual([0, []])
  })

  it('hands a pair whose codes would overflow one item to the owner', async () => {
    const w = world({
      pairs: [{ a: MILK, b: MILK_POINT, meaning: 0.97 }],
      refuse: { refused: 'barcodes' },
    })
    const report = await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-06')
    expect([report.merged, report.candidates]).toEqual([0, 1])
  })

  it('names at most ten of each, and counts the rest', async () => {
    const pairs = Array.from({ length: MERGE_NOTICE_PAIRS + 2 }, (_, i) => ({
      a: side(`c${String(i)}a`, `Товар ${String(i)}`, '2026-09-01'),
      b: side(`c${String(i)}b`, `Товар ${String(i)}`, '2026-09-02'),
      meaning: 0.99,
    }))
    const report = await mergeNight(
      { merges: world({ pairs }).merges, embedder: NO_EMBEDDER },
      'on',
      '2026-10-06',
    )
    expect([report.merged, report.mergedPairs.length]).toEqual([
      MERGE_NOTICE_PAIRS + 2,
      MERGE_NOTICE_PAIRS,
    ])
  })

  it('names places of one city by their spelling when the model is away', async () => {
    const groups = [
      [
        { id: 'p1', name: 'Ереван Сити', city: 'Гюмри', createdAt: new Date('2026-09-01') },
        { id: 'p2', name: 'Ереван  Сити', city: 'Гюмри', createdAt: new Date('2026-09-02') },
        { id: 'p3', name: 'SOS', city: 'Гюмри', createdAt: new Date('2026-09-03') },
      ],
    ]
    const w = world({ groups })
    const report = await mergeNight({ merges: w.merges, embedder: NO_EMBEDDER }, 'on', '2026-10-06')
    // No vector, no merge: one key, so a candidate.
    expect([w.merged, report.candidatePairs]).toEqual([
      [],
      [
        {
          subject: 'place',
          from: 'Ереван  Сити',
          into: 'Ереван Сити',
          fromId: 'p2',
          intoId: 'p1',
          city: 'Гюмри',
        },
      ],
    ])
  })
})

describe('mergeTick', () => {
  const at = (time: string) => new Date(`2026-10-06T${time}Z`)
  const deps = (w: ReturnType<typeof world>, owner = true) => ({
    merges: w.merges,
    embedder: NO_EMBEDDER,
    notices: w.notices,
    owner,
  })

  it('runs the night from half past four in Yerevan, once, and reports from nine', async () => {
    const w = world({ pairs: [{ a: MILK, b: MILK_POINT, meaning: 0.97 }] })
    await mergeTick(deps(w), 'on', at('00:29:00'))
    expect(w.merged).toEqual([])
    await mergeTick(deps(w), 'on', at('00:30:00'))
    await mergeTick(deps(w), 'on', at('01:30:00'))
    expect(w.merged).toHaveLength(1)
    expect(w.queued).toEqual([])
    await mergeTick(deps(w), 'on', at('05:00:00'))
    await mergeTick(deps(w), 'on', at('05:01:00'))
    expect(w.queued.map((notice) => notice.kind)).toEqual(['catalogue_merged'])
  })

  it('does nothing when off, or when another instance has the night', async () => {
    const off = world({ pairs: [{ a: MILK, b: MILK_POINT, meaning: 0.97 }] })
    await mergeTick(deps(off), 'off', at('06:00:00'))
    expect([off.merged, off.queued]).toEqual([[], []])
    const taken = world({ pairs: [{ a: MILK, b: MILK_POINT, meaning: 0.97 }], claimed: true })
    await mergeTick(deps(taken), 'on', at('06:00:00'))
    expect(taken.merged).toEqual([])
  })

  it('marks the report handed and tells nobody where there is no owner', async () => {
    const w = world()
    await mergeTick(deps(w, false), 'report', at('06:00:00'))
    expect(w.queued).toEqual([])
    await mergeTick(deps(w, true), 'report', at('06:01:00'))
    expect(w.queued).toEqual([])
  })
})
