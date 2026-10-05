import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { z } from 'zod'
import { moneyCodec, quantityCodec } from '@molvia/model'
import type { Money, Quantity } from '@molvia/model'
import { useActorStore } from '@/stores/actor'
import { isRecord } from '@/stores/queueing'
import { read, write } from '@/stores/storage'

/** How much and what the line cost, as the person typed them. */
export interface LineFigures {
  readonly quantity: Quantity | null
  readonly amount: Money | null
}

/**
 * A line as the person left it on the review (MOL-127, Т-9): the item — one of the catalogue, or a
 * new one by its name — and whether it is recorded at all. `figures` only once the person changed
 * them: until then the line is recorded at what the server or the person's total works out, whatever
 * else was edited (review 28).
 */
export interface LineDraft {
  readonly item: { readonly id: string; readonly name: string } | { readonly name: string }
  readonly figures?: LineFigures
  readonly skip: boolean
  /** The person chose the item — «проверьте» is answered (review 16). */
  readonly confirmed?: true
}

/** A place as the review holds it: one of the catalogue, or a new shop by its name and city. */
export type PlaceDraft =
  | { readonly id: string; readonly name: string; readonly city: string }
  | { readonly name: string; readonly city: string }

/** The catalogue's id of a place, or null for a new shop named by the person. */
export function placeIdOf(place: PlaceDraft): string | null {
  return 'id' in place && typeof place.id === 'string' ? place.id : null
}

/**
 * The edits of one receipt before it is recorded (В-6): only what the person changed — a line left
 * alone follows the server's answer, which may still learn from the shop's memory (Р-1 of MOL-126).
 * `total` — the receipt's total as the person corrected it (Р-8).
 */
export interface ReceiptDraft {
  readonly lines: Readonly<Record<number, LineDraft>>
  readonly place?: PlaceDraft
  readonly purchasedOn?: string
  readonly total?: Money
}

const lineCodec = z.strictObject({
  item: z.union([
    z.strictObject({ id: z.uuid(), name: z.string() }),
    z.strictObject({ name: z.string() }),
  ]),
  figures: z
    .strictObject({ quantity: quantityCodec.nullable(), amount: moneyCodec.nullable() })
    .optional(),
  skip: z.boolean(),
  confirmed: z.literal(true).optional(),
})

const draftCodec = z.strictObject({
  lines: z.record(z.string().regex(/^\d+$/), lineCodec),
  place: z
    .union([
      z.strictObject({ id: z.uuid(), name: z.string(), city: z.string() }),
      z.strictObject({ name: z.string(), city: z.string() }),
    ])
    .optional(),
  purchasedOn: z.iso.date().optional(),
  total: moneyCodec.optional(),
})

const KEY = 'molvia.receipt-drafts'

/**
 * The item the review showed for a line when the person first put it right (MOL-222, adversarial В1):
 * the shops' memory learns from every record, and a review read again after another record shows the
 * person's own correction as though the reading had made it — the edit vanished from the measure.
 * **Beside the drafts, never inside**: a draft line is read strictly by the build before, which would
 * drop the whole receipt's draft for a field it does not know.
 */
const SHOWN_KEY = 'molvia.receipt-shown'

/** Per receipt, per line: the item id shown at the first edit, `null` — a new item was shown. */
type Shown = Record<string, Record<string, string | null>>

const shownCodec = z.record(z.string(), z.record(z.string().regex(/^\d+$/), z.uuid().nullable()))

function recallShown(owner: string | null): Shown {
  if (!owner) return {}
  const raw = read(`${SHOWN_KEY}.${owner}`)
  if (!raw) return {}
  try {
    const parsed = shownCodec.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function recall(owner: string | null): Record<string, ReceiptDraft> {
  if (!owner) return {}
  const raw = read(`${KEY}.${owner}`)
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!isRecord(parsed)) return {}
  // One broken draft is dropped alone: the others are somebody's edits.
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([id, value]) => {
      const parsed = draftCodec.safeParse(value)
      if (!parsed.success) return []
      const { place, purchasedOn, total } = parsed.data
      const draft: ReceiptDraft = {
        lines: Object.fromEntries(
          Object.entries(parsed.data.lines).map(([position, line]) => {
            const { confirmed, figures, item, skip } = line
            const kept: LineDraft = {
              item,
              skip,
              ...(figures ? { figures } : {}),
              ...(confirmed ? { confirmed } : {}),
            }
            return [Number(position), kept]
          }),
        ),
        ...(place ? { place } : {}),
        ...(purchasedOn ? { purchasedOn } : {}),
        ...(total ? { total } : {}),
      }
      return [[id, draft]]
    }),
  )
}

/**
 * The review's edits, kept on the phone under the owner (MOL-127, Т-9, В-6): they outlive the app
 * being closed and need no connection, as the drafts of verdicts do. Gone once the receipt is
 * recorded or nothing names it any more; «Выйти» takes them with the drawer.
 */
export const useReceiptDraftsStore = defineStore('receiptDrafts', () => {
  const actor = useActorStore()
  const drafts = ref<Record<string, ReceiptDraft>>(recall(actor.id))
  const shown = ref<Shown>(recallShown(actor.id))

  watch(
    () => actor.id,
    (id) => {
      drafts.value = recall(id)
      shown.value = recallShown(id)
    },
  )
  window.addEventListener('storage', (event) => {
    if (actor.id && event.key === `${KEY}.${actor.id}`) drafts.value = recall(actor.id)
    if (actor.id && event.key === `${SHOWN_KEY}.${actor.id}`) shown.value = recallShown(actor.id)
  })

  function keepShown(edit: (all: Shown) => Shown): void {
    const owner = actor.id
    if (!owner) return
    shown.value = edit(recallShown(owner))
    write(`${SHOWN_KEY}.${owner}`, JSON.stringify(shown.value))
  }

  function persist(): void {
    const owner = actor.id
    if (!owner) return
    const encoded = Object.fromEntries(
      Object.entries(drafts.value).map(([id, draft]) => [
        id,
        draftCodec.encode({
          ...draft,
          lines: Object.fromEntries(
            Object.entries(draft.lines).map(([position, line]) => [position, line]),
          ),
        }),
      ]),
    )
    write(`${KEY}.${owner}`, JSON.stringify(encoded))
  }

  function change(receiptId: string, edit: (draft: ReceiptDraft) => ReceiptDraft): void {
    // Read again first: another window may have edited the same receipt.
    drafts.value = recall(actor.id)
    const draft = drafts.value[receiptId] ?? { lines: {} }
    drafts.value = { ...drafts.value, [receiptId]: edit(draft) }
    persist()
  }

  return {
    drafts,
    draftOf: (receiptId: string): ReceiptDraft | null => drafts.value[receiptId] ?? null,
    /** The items the review showed at each line's first edit (adversarial В1). */
    shownOf: (receiptId: string): Readonly<Record<number, string | null>> =>
      Object.fromEntries(
        Object.entries(shown.value[receiptId] ?? {}).map(([position, item]) => [
          Number(position),
          item,
        ]),
      ),
    /** A line put right; `showing` — the item the review shows it with now, kept from the first edit. */
    setLine(receiptId: string, position: number, line: LineDraft, showing?: string | null): void {
      change(receiptId, (draft) => ({ ...draft, lines: { ...draft.lines, [position]: line } }))
      if (showing === undefined) return
      keepShown((all) => {
        const lines = all[receiptId] ?? {}
        if (String(position) in lines) return all
        return { ...all, [receiptId]: { ...lines, [String(position)]: showing } }
      })
    },
    setPlace(receiptId: string, place: PlaceDraft, purchasedOn: string): void {
      change(receiptId, (draft) => ({ ...draft, place, purchasedOn }))
    },
    setTotal(receiptId: string, total: Money | null): void {
      change(receiptId, (draft) => {
        const rest: ReceiptDraft = {
          lines: draft.lines,
          ...(draft.place ? { place: draft.place } : {}),
          ...(draft.purchasedOn ? { purchasedOn: draft.purchasedOn } : {}),
        }
        return total ? { ...rest, total } : rest
      })
    },
    forget(receiptId: string): void {
      keepShown((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== receiptId)))
      drafts.value = recall(actor.id)
      if (!(receiptId in drafts.value)) return
      drafts.value = Object.fromEntries(
        Object.entries(drafts.value).filter(([id]) => id !== receiptId),
      )
      persist()
    },
    /** Lets go of the drafts of every receipt not named — recorded, removed, gone (Т-4). */
    keepOnly(receiptIds: ReadonlySet<string>): void {
      if (Object.keys(recallShown(actor.id)).some((id) => !receiptIds.has(id))) {
        keepShown((all) =>
          Object.fromEntries(Object.entries(all).filter(([id]) => receiptIds.has(id))),
        )
      }
      drafts.value = recall(actor.id)
      const kept = Object.fromEntries(
        Object.entries(drafts.value).filter(([id]) => receiptIds.has(id)),
      )
      if (Object.keys(kept).length === Object.keys(drafts.value).length) return
      drafts.value = kept
      persist()
    },
  }
})
