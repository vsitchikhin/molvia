import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { ERROR, receiptsResponseCodec } from '@molvia/model'
import type { Money, ReceiptSummary, WireCode } from '@molvia/model'
import { api } from '@/api'
import { useKeptAnswer } from '@/composables/useKeptAnswer'
import type { KeptPhase } from '@/composables/useKeptAnswer'
import { photoShelf } from '@/receipts/photoShelf'
import { useActorStore } from '@/stores/actor'
import { useReceiptDraftsStore } from '@/stores/receiptDrafts'
import { receiptOf, useReceiptQueueStore } from '@/stores/receiptQueue'
import type { RejectedReceiptWrite } from '@/stores/receiptQueue'

/** How often «Покупки» ask again while a receipt is being read: a reading takes about 30 s (MOL-114). */
export const RECEIPT_POLL_MS = 5000

/**
 * Where a receipt is, as «Покупки» say it (handoff 03): two of the states are the phone's queue —
 * waiting for a connection, refused — the rest are the server's.
 */
export type ReceiptRowState =
  'waiting' | 'sending' | 'rejected' | 'parsing' | 'parsed' | 'recording' | 'failed'

export interface ReceiptRow {
  readonly id: string
  readonly state: ReceiptRowState
  readonly capturedAt: Date
  readonly parts: number
  /** The server's answer, when it has one. */
  readonly summary: ReceiptSummary | null
  /** «Не принят»: the refusal «Убрать» takes away. */
  readonly rejected: RejectedReceiptWrite | null
}

/** Why a receipt was not accepted, in the words of «Не принят: …». */
export function rejectedReason(code: WireCode): 'not_photo' | 'too_large' | 'lost' | 'other' {
  if (code === ERROR.RECEIPT_NOT_PHOTO) return 'not_photo'
  if (code === ERROR.RECEIPT_TOO_LARGE) return 'too_large'
  if (code === ERROR.NOT_FOUND) return 'lost'
  return 'other'
}

/** The rows a working section shows (`Разбираем`), and the ones to look at (`Посмотреть и записать`). */
export const WORKING: readonly ReceiptRowState[] = ['waiting', 'sending', 'rejected', 'parsing']

export interface ReceiptsScreen {
  readonly rows: ComputedRef<ReceiptRow[]>
  readonly phase: ComputedRef<KeptPhase>
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
 * **Asked again every few seconds while something is being read** (Р-4) and the screen is in view:
 * there is no push. The answer is kept on the phone, so offline the list stands as last read.
 * Every list read lets the photo shelf and the drafts go of receipts nothing names any more (Т-4).
 */
export function useReceipts(): ReceiptsScreen {
  const actor = useActorStore()
  const queue = useReceiptQueueStore()
  const drafts = useReceiptDraftsStore()
  const online = ref(navigator.onLine)

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
    const rejectedOf = new Map(
      queue.rejected
        .filter((item) => item.write.kind !== 'record')
        .map((item) => [receiptOf(item.write), item]),
    )
    const recording = new Set(
      queue.pending.filter((write) => write.kind === 'record').map((write) => write.id),
    )
    const uploading = new Map(
      queue.pending.flatMap((write) =>
        write.kind === 'create' ? [[write.body.id, write.body]] : [],
      ),
    )
    const partsWaiting = new Set(
      queue.pending.filter((write) => write.kind === 'part').map((write) => write.id),
    )
    const result = new Map<string, ReceiptRow>()

    for (const summary of kept.answer.value?.receipts ?? []) {
      if (summary.status === 'recorded' || removing.has(summary.id)) continue
      const rejected = rejectedOf.get(summary.id) ?? null
      let state: ReceiptRowState
      if (rejected) state = 'rejected'
      else if (summary.status === 'uploading' || partsWaiting.has(summary.id))
        state = online.value ? 'sending' : 'waiting'
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
      })
    }
    for (const [id, rejected] of rejectedOf) {
      if (removing.has(id) || result.has(id)) continue
      const write = rejected.write
      result.set(id, {
        id,
        state: 'rejected',
        capturedAt: write.kind === 'create' ? write.body.capturedAt : new Date(),
        parts: write.kind === 'create' ? write.body.parts : 1,
        summary: null,
        rejected,
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
    },
  )

  let timer: ReturnType<typeof setInterval> | undefined
  const listen = () => {
    online.value = navigator.onLine
  }
  onMounted(() => {
    window.addEventListener('online', listen)
    window.addEventListener('offline', listen)
    timer = setInterval(() => {
      const reading = rows.value.some((row) => row.state === 'parsing' || row.state === 'sending')
      if (reading && online.value && document.visibilityState === 'visible') void kept.retry()
    }, RECEIPT_POLL_MS)
  })
  onUnmounted(() => {
    clearInterval(timer)
    window.removeEventListener('online', listen)
    window.removeEventListener('offline', listen)
  })

  return {
    rows,
    phase: kept.phase,
    retry: kept.retry,
    total: (row) => row.summary?.total ?? null,
    online,
  }
}
