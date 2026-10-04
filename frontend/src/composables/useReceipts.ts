import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ERROR, receiptsResponseCodec } from '@molvia/model'
import type { Money, ReceiptSummary, WireCode } from '@molvia/model'
import { api } from '@/api'
import { useKeptAnswer } from '@/composables/useKeptAnswer'
import { useOnline } from '@/composables/useOnline'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { photoShelf } from '@/receipts/photoShelf'
import { useActorStore } from '@/stores/actor'
import { useReceiptDraftsStore } from '@/stores/receiptDrafts'
import { receiptOf, useReceiptQueueStore } from '@/stores/receiptQueue'
import type { RejectedReceiptWrite } from '@/stores/receiptQueue'

/** How often «Покупки» ask again while a receipt is being read: a reading takes about 30 s (MOL-114). */
export const RECEIPT_POLL_MS = 5000

/**
 * Where a receipt is, as «Покупки» say it (handoff 03): the queue of this phone says three of them —
 * waiting for a connection, sending, not accepted — the server the rest. `stuck` — the server holds a
 * receipt with parts missing, and this phone has none of them to send and did not deliver it whole:
 * another phone's, or one whose queue «Выйти» took (adversarial А2, Б1).
 */
export type ReceiptRowState =
  'waiting' | 'sending' | 'stuck' | 'rejected' | 'parsing' | 'parsed' | 'recording' | 'failed'

export interface ReceiptRow {
  readonly id: string
  readonly state: ReceiptRowState
  readonly capturedAt: Date
  readonly parts: number
  /** The server's answer, when it has one. */
  readonly summary: ReceiptSummary | null
  /** «Не принят»: the refusal «Убрать» takes away. */
  readonly rejected: RejectedReceiptWrite | null
  /** «Записать» was refused: the review says why, the row says to open it (review 20). */
  readonly recordRefused: boolean
}

/** Why a receipt was not accepted, in the words of «Не принят: …». */
export function rejectedReason(code: WireCode): 'not_photo' | 'too_large' | 'lost' | 'other' {
  if (code === ERROR.RECEIPT_NOT_PHOTO) return 'not_photo'
  if (code === ERROR.RECEIPT_TOO_LARGE) return 'too_large'
  if (code === ERROR.NOT_FOUND) return 'lost'
  return 'other'
}

/** The rows a working section shows (`Разбираем`), and the ones to look at (`Посмотреть и записать`). */
export const WORKING: readonly ReceiptRowState[] = [
  'waiting',
  'sending',
  'stuck',
  'rejected',
  'parsing',
]

/** Being sent or read — what the newcomer's (б) speaks of; a refused or stuck receipt is not (А4). */
export const UNDER_WAY: readonly ReceiptRowState[] = ['waiting', 'sending', 'parsing']

export interface ReceiptsScreen {
  readonly rows: ComputedRef<ReceiptRow[]>
  /** The server has answered, and there is no receipt to show — «пусто» may be said (MOL-77). */
  readonly knownEmpty: ComputedRef<boolean>
  /** Why the list on screen is not this visit's, or why there is none (MOL-19). */
  readonly trouble: ComputedRef<'error' | 'offline' | null>
  readonly retry: () => Promise<void>
  readonly total: (row: ReceiptRow) => Money | null
  readonly online: Ref<boolean>
}

/**
 * The receipts of «Покупки» (MOL-127, Т-5): the queue on the phone and `GET /receipts`, one row per
 * receipt. The phone's state wins while it holds the receipt — «ждёт связи», «не принят»,
 * «запишем, когда появится связь» — then the server's. A recorded receipt is a row of «Записаны»
 * and not here; one being removed is nowhere.
 *
 * **Asked of everyone** (MOL-109, adversarial А2): the camera is for a person whose country the
 * server reads (Р-1), but a receipt taken before a move to Georgia or Serbia is still theirs to look
 * at, record or remove — asked only of the first, it vanished from «Покупки» and went with its 28
 * days, its photos held on the phone. **Asked again every few seconds only while one is being read** (Р-4, adversarial
 * А2) and the screen is in view: there is no push, and nothing else moves by itself. The answer is
 * kept on the phone, so offline the list stands as last read. Every list read lets the photo shelf
 * and the drafts go of receipts nothing names any more (Т-4).
 */
export function useReceipts(): ReceiptsScreen {
  const actor = useActorStore()
  const queue = useReceiptQueueStore()
  const drafts = useReceiptDraftsStore()
  const online = useOnline()
  const { country } = useReceiptCapture()

  const kept = useKeptAnswer({
    key: 'molvia.receipts',
    subject: ref('all'),
    ask: () => api.receipts(),
    codec: receiptsResponseCodec,
    kept: 1,
  })

  const rows = computed<ReceiptRow[]>(() => {
    const removing = new Set(
      queue.pending.filter((write) => write.kind === 'remove').map((write) => write.id),
    )
    const lastRemoved = queue.lastRemoved?.undo.id
    if (lastRemoved) removing.add(lastRemoved)
    // Only a photo the server refused is «не принят»: a refused removal or «Вернуть» is no photo.
    const rejectedOf = new Map(
      queue.rejected
        .filter((item) => item.write.kind === 'create' || item.write.kind === 'part')
        .map((item) => [receiptOf(item.write), item]),
    )
    const refusedRecords = new Set(
      queue.rejected.flatMap((item) => (item.write.kind === 'record' ? [item.write.id] : [])),
    )
    const recording = new Set(
      queue.pending.filter((write) => write.kind === 'record').map((write) => write.id),
    )
    const uploading = new Map(
      queue.pending.flatMap((write) =>
        write.kind === 'create' ? [[write.body.id, write.body] as const] : [],
      ),
    )
    const sendingHere = new Set(
      queue.pending.flatMap((write) =>
        write.kind === 'part' || write.kind === 'create' ? [receiptOf(write)] : [],
      ),
    )
    const result = new Map<string, ReceiptRow>()

    for (const summary of kept.answer.value?.receipts ?? []) {
      if (summary.status === 'recorded' || removing.has(summary.id)) continue
      const rejected = rejectedOf.get(summary.id) ?? null
      let state: ReceiptRowState
      if (rejected) state = 'rejected'
      else if (sendingHere.has(summary.id)) state = online.value ? 'sending' : 'waiting'
      // Delivered whole from here: the list was read before the last part landed (review 29, Б1).
      else if (summary.status === 'uploading')
        state = summary.id in queue.delivered ? 'parsing' : 'stuck'
      else if (summary.status === 'parsed')
        state = recording.has(summary.id) ? 'recording' : 'parsed'
      else if (summary.status === 'failed') state = 'failed'
      else state = 'parsing'
      result.set(summary.id, {
        id: summary.id,
        state,
        capturedAt: summary.capturedAt,
        parts: summary.parts,
        summary,
        rejected,
        recordRefused: refusedRecords.has(summary.id),
      })
    }
    // What the server does not know yet, or did not take: the phone's own word.
    for (const [id, body] of uploading) {
      if (removing.has(id) || result.has(id)) continue
      result.set(id, {
        id,
        state: online.value ? 'sending' : 'waiting',
        capturedAt: body.capturedAt,
        parts: body.parts,
        summary: null,
        rejected: null,
        recordRefused: false,
      })
    }
    for (const [id, rejected] of rejectedOf) {
      if (removing.has(id) || result.has(id)) continue
      const write = rejected.write
      result.set(id, {
        id,
        state: 'rejected',
        capturedAt: write.kind === 'create' ? write.body.capturedAt : new Date(rejected.at),
        parts: write.kind === 'create' ? write.body.parts : 1,
        summary: null,
        rejected,
        recordRefused: false,
      })
    }
    return [...result.values()].sort(
      (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime() || b.id.localeCompare(a.id),
    )
  })

  // Whatever nothing names any more goes off the phone: photos of receipts recorded, removed for
  // good or gone with their 28 days, and their drafts.
  watch(
    () => kept.answer.value,
    (answer) => {
      const owner = actor.id
      if (!answer || !owner) return
      const named = new Set([
        ...answer.receipts.filter((one) => one.status !== 'recorded').map((one) => one.id),
        ...queue.pending.map(receiptOf),
        ...queue.rejected.map((item) => receiptOf(item.write)),
      ])
      const lastRemoved = queue.lastRemoved?.undo.id
      if (lastRemoved) named.add(lastRemoved)
      void photoShelf(owner).keepOnly(named)
      drafts.keepOnly(named)
      queue.settleDelivered(
        new Set(answer.receipts.filter((one) => one.status !== 'uploading').map((one) => one.id)),
      )
    },
  )

  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(() => {
      const reading = rows.value.some((row) => row.state === 'parsing')
      if (reading && online.value && document.visibilityState === 'visible') void kept.retry()
    }, RECEIPT_POLL_MS)
  })
  onUnmounted(() => {
    clearInterval(timer)
  })

  return {
    rows,
    knownEmpty: computed(() => kept.answer.value !== null && rows.value.length === 0),
    trouble: computed(() => {
      // Said only where receipts are the screen's: to a person who takes them, or who holds one.
      if (!country.value && rows.value.length === 0) return null
      const stale = kept.stale.value
      if (stale === 'error' || stale === 'offline') return stale
      const phase = kept.phase.value
      return phase === 'error' || phase === 'offline' ? phase : null
    }),
    retry: kept.retry,
    total: (row) => row.summary?.total ?? null,
    online,
  }
}
