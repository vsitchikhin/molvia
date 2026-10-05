import { z } from 'zod'

/**
 * What the nightly merge of twins works on (MOL-106): items of the catalogue, and places — merged in
 * from MOL-50, by the same rule, into the same journal and the same report.
 */
export const MERGE_SUBJECTS = ['item', 'place'] as const
export const mergeSubjectSchema = z.enum(MERGE_SUBJECTS)
export type MergeSubject = z.infer<typeof mergeSubjectSchema>

/**
 * How the night runs, from the API's environment: `on` merges, `report` only says what it would
 * merge (the first week in production, owner's decision В-3), `off` does not look.
 */
export const CATALOGUE_MERGE_MODES = ['on', 'report', 'off'] as const
export const catalogueMergeModeSchema = z.enum(CATALOGUE_MERGE_MODES)
export type CatalogueMergeMode = z.infer<typeof catalogueMergeModeSchema>

/** How many pairs of each list one morning's message names; the rest are counted. */
export const MERGE_NOTICE_PAIRS = 10

const named = z.string().min(1).max(200)

/** A pair merged, or one `report` would have merged. `id` is the journal's number, the one `make unmerge` takes. */
export const mergedPairSchema = z.strictObject({
  subject: mergeSubjectSchema,
  from: named,
  into: named,
  /** A place's city: two cities may hold one name (MOL-120). */
  city: z.string().min(1).max(120).optional(),
  id: z.int().positive().optional(),
})
export type MergedPair = z.infer<typeof mergedPairSchema>

/**
 * A pair named to the owner and not merged, by ids too, which `make merge FROM= INTO=` takes (В-2):
 * `from` is the younger, `into` the older — the one a merge would keep.
 */
export const candidatePairSchema = z.strictObject({
  subject: mergeSubjectSchema,
  from: named,
  into: named,
  fromId: z.uuid(),
  intoId: z.uuid(),
  city: z.string().min(1).max(120).optional(),
})
export type CandidatePair = z.infer<typeof candidatePairSchema>

/**
 * The morning's report of the night's merge (MOL-106): how many merged and how many new candidates,
 * and the first of each by name. Names of the catalogue and of places only — nobody's.
 */
export const catalogueMergedNoticeSchema = z.strictObject({
  kind: z.literal('catalogue_merged'),
  /** The night, as a day in Yerevan: `2026-10-06`. */
  day: z.iso.date(),
  mode: z.enum(['on', 'report']),
  merged: z.int().nonnegative(),
  candidates: z.int().nonnegative(),
  mergedPairs: z.array(mergedPairSchema).max(MERGE_NOTICE_PAIRS),
  candidatePairs: z.array(candidatePairSchema).max(MERGE_NOTICE_PAIRS),
})
export type CatalogueMergedNotice = z.infer<typeof catalogueMergedNoticeSchema>
