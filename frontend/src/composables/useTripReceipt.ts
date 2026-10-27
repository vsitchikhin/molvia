import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
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
  /**
   * The button under the total: «+ Сумма по чеку», «Изменить сумму по чеку» once a sum is there or on
   * its way, or none — one rule for the record open and the finished one (MOL-206, review 4).
   */
  readonly receiptAction: ComputedRef<string | null>
  /** Rows on screen, one being removed not among them — what both questions of a record count (Р-5). */
  readonly kept: ComputedRef<number>
  readonly unpriced: ComputedRef<number>
  /**
   * The rows on screen are the server's: none being removed or waiting to be sent (MOL-207, adversarial
   * Б1). Its figures of the prices are of this list then, and of another while a write is on its way —
   * a purchase swapped for another keeps both counts and changes the list.
   */
  readonly settled: ComputedRef<boolean>
}

export function useTripReceipt(
  tripId: Ref<string | null>,
  trip: Ref<TripView | null>,
  rows: Ref<readonly TripRowView[]>,
  /**
   * Whether the trip is the server's answer, which knows its receipt. A finished record read back from
   * the phone's cache does not keep it yet, so its total may be a receipt with nothing saying so: the
   * sheet would open empty over a sum that is there (MOL-78, review 4).
   */
  known: () => boolean = () => true,
): TripReceipt {
  const { t } = useI18n()
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

  const shown = computed(() => rows.value.filter((row) => row.mark !== 'removing'))
  const offerReceipt = computed(() => shown.value.length > 0)
  /** Rows on screen with no price — what «Закончить» asks about (В-4). */
  const unpriced = computed(() => shown.value.filter((row) => row.amount === null).length)

  const receiptAction = computed(() => {
    if (!known()) return null
    if (receiptCurrent.value) return t('trip.receipt.edit')
    return offerReceipt.value ? t('trip.receipt.add') : null
  })

  return {
    receiptOpen,
    receiptWaiting,
    receiptCurrent,
    offerReceipt,
    receiptAction,
    kept: computed(() => shown.value.length),
    unpriced,
    settled: computed(() =>
      rows.value.every((row) => row.mark !== 'removing' && row.mark !== 'waiting'),
    ),
  }
}
