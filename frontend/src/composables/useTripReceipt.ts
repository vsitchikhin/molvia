import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { Money, TripView } from '@molvia/model'
import type { TripRowView } from '@/components/tripRow'
import { useTripQueueStore } from '@/stores/tripQueue'

/**
 * «Сумма по чеку» of one record (MOL-78), the same on a record open and a finished one: the sheet
 * that types it, what the queue still holds of it, and whether the screen offers it at all.
 *
 * The sum is offered only on a record with purchases (owner's decision В-1): money with no purchases
 * is a spending, and a record without one goes to «Деньги» instead. What the phone counts here is
 * rows, never money — the figures of the sum are the server's.
 */
export interface TripReceipt {
  readonly receiptOpen: Ref<boolean>
  readonly receiptWaiting: ComputedRef<{ readonly receipt: Money | null } | null>
  readonly receiptCurrent: ComputedRef<Money | null>
  readonly offerReceipt: ComputedRef<boolean>
  readonly unpriced: ComputedRef<number>
}

export function useTripReceipt(
  tripId: Ref<string | null>,
  trip: Ref<TripView | null>,
  rows: Ref<readonly TripRowView[]>,
): TripReceipt {
  const queue = useTripQueueStore()
  const receiptOpen = ref(false)

  /** The sum still in the queue, the last one typed — the one that will land; null for none. */
  const receiptWaiting = computed<{ readonly receipt: Money | null } | null>(() => {
    const id = tripId.value
    const write = queue.pending.findLast((item) => item.kind === 'receipt' && item.tripId === id)
    return write?.kind === 'receipt' ? { receipt: write.body.receipt } : null
  })

  /** What the sheet opens on: the sum on its way, else the one the server holds. */
  const receiptCurrent = computed<Money | null>(() =>
    receiptWaiting.value ? receiptWaiting.value.receipt : (trip.value?.receipt ?? null),
  )

  const kept = computed(() => rows.value.filter((row) => row.mark !== 'removing'))
  const offerReceipt = computed(() => kept.value.length > 0)
  /** Rows on screen with no price — what «Закончить» asks about (В-4). */
  const unpriced = computed(() => kept.value.filter((row) => row.amount === null).length)

  return { receiptOpen, receiptWaiting, receiptCurrent, offerReceipt, unpriced }
}
