import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { unitPrice } from '@molvia/model'
import type { TripView } from '@molvia/model'
import type { RowMark, TripRowView } from '@/components/tripRow'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite } from '@/stores/tripQueue'

/** The same purchases and queue marks on both the active and a selected trip. */
export function useTripRows(
  tripId: ComputedRef<string | null>,
  trip: ComputedRef<TripView | null>,
  unnamed: () => string,
): { rows: ComputedRef<TripRowView[]>; waiting: ComputedRef<number> } {
  const queue = useTripQueueStore()
  /** What the queue still holds about this trip, by the row it is about. */
  const held = computed(() => {
    const marks = new Map<string, RowMark>()
    const added: QueuedWrite[] = []
    for (const write of queue.pending) {
      if (write.tripId !== tripId.value) continue
      if (write.kind === 'add') added.push(write)
      // «Удаляется» outlasts «правка не ушла»: the row is going, whatever else was asked of it.
      if (write.kind === 'update' && marks.get(write.expenseId) !== 'removing') {
        marks.set(write.expenseId, 'editing')
      }
      if (write.kind === 'remove') marks.set(write.expenseId, 'removing')
    }
    return { marks, added }
  })

  const rows = computed<TripRowView[]>(() => {
    // A purchase the server already has, queued again, is a correction on its way: it says so
    // on the row it is about, and never as a second line (Т-12).
    const correcting = new Set(
      held.value.added.flatMap((write) => (write.kind === 'add' ? [write.body.id] : [])),
    )
    const server = (trip.value?.expenses ?? []).map((expense): TripRowView => ({
      key: expense.id,
      name: expense.item.name,
      quantity: expense.quantity,
      amount: expense.amount,
      unitPrice: expense.unitPrice,
      mark: held.value.marks.get(expense.id) ?? (correcting.has(expense.id) ? 'editing' : null),
      entry: expense.item,
      expense,
    }))
    const written = new Set(server.map((row) => row.key))
    const queued = held.value.added.flatMap((write): TripRowView[] =>
      // The server answered it while the queue still holds the write — the connection dropped
      // between the write and its answer, or the purchase is being corrected and goes as an
      // amendment. One purchase, one line, and the line says the correction is on its way
      // (В2-2, Т-12).
      write.kind === 'add' && !written.has(write.body.id)
        ? [
            {
              key: write.body.id,
              name: write.entry?.name ?? unnamed(),
              quantity: write.body.quantity ?? null,
              amount: write.body.amount ?? null,
              unitPrice:
                write.body.amount && write.body.quantity
                  ? unitPrice(write.body.amount, write.body.quantity)
                  : null,
              mark: 'waiting',
              entry: write.entry,
              expense: null,
            },
          ]
        : [],
    )
    return [...server, ...queued]
  })

  const waiting = computed(() => rows.value.filter((row) => row.mark === 'waiting').length)

  return { rows, waiting }
}
