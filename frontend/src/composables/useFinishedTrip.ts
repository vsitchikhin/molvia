import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { SelectedTrip } from './useSelectedTrip'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import { currencySchema } from '@molvia/model'
import type { CatalogueEntry, Currency, Money, TripExpenseView } from '@molvia/model'
import type { TripRowView } from '@/components/tripRow'
import type { CodeHeld } from '@/stores/receiptQueue'
import { upTarget, useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { useTripHistoryStore } from '@/stores/tripHistory'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { RetryPurchase } from './useItemDetails'
import { useSelectedTrip } from './useSelectedTrip'
import { useTripReceipt } from './useTripReceipt'
import { useTripRows } from './useTripRows'

interface OpenedPurchase {
  key: number
  entry: CatalogueEntry
  expense: TripExpenseView | null
  retry: RetryPurchase | null
}
interface FinishedTrip extends Omit<SelectedTrip, 'load'> {
  t: ReturnType<typeof useI18n>['t']
  name: ComputedRef<string>
  meta: ComputedRef<string>
  /** The purchases just written from a receipt, said once on arrival (MOL-127, 5o). */
  recorded: Ref<number | null>
  codesHeld: Ref<CodeHeld[]>
  toVerdicts: () => void
  rows: ComputedRef<TripRowView[]>
  waiting: ComputedRef<number>
  /** «Сумма по чеку» of this record (MOL-78). */
  receiptOpen: Ref<boolean>
  receiptWaiting: ComputedRef<{ readonly receipt: Money | null } | null>
  receiptCurrent: ComputedRef<Money | null>
  offerReceipt: ComputedRef<boolean>
  /** What a new sum starts in: the record's currency, as the purchase sheet takes it. */
  receiptCurrency: ComputedRef<Currency>
  /**
   * Whether the trip shown is the server's answer, which knows its receipt's sum — not one read back
   * from the phone's shelf, here or by another window (MOL-78, reviews 4 and Е).
   */
  receiptKnown: ComputedRef<boolean>
  opened: Ref<OpenedPurchase | null>
  pending: ComputedRef<boolean>
  rejected: ComputedRef<boolean>
  removing: Ref<boolean>
  removal: Ref<{ place: string; day: Date | null; items: number }>
  askRemove(): void
  confirmRemove(): void
  afterRemoveSheet(): void
  review(): void
  amend(row: TripRowView): void
  close(): void
  find(): void
  history(): void
  load(): void
}
export function useFinishedTrip(): FinishedTrip {
  const route = useRoute()
  const router = useRouter()
  const { t, locale } = useI18n()
  const queue = useTripQueueStore()
  const { goBack, goTab, goUp } = useNavigation()
  /**
   * To «Покупки», where the refusals stand and the list is: up, when it is this screen's parent —
   * a push laid a second «Покупки» over the first and «back» met it again (review Р-17); opened
   * from «Деньги», «Покупки» is somewhere else, and pushed.
   */
  function toPurchases(): void {
    if (upTarget(router, route)?.location.name === 'purchases') void goUp()
    else void router.push({ name: 'purchases' })
  }
  const selected = useSelectedTrip(() =>
    typeof route.params.tripId === 'string' ? route.params.tripId : null,
  )
  const { rows, waiting } = useTripRows(selected.id, selected.trip, () => t('trip.queued.unnamed'))
  const { receiptOpen, receiptWaiting, receiptCurrent, offerReceipt } = useTripReceipt(
    selected.id,
    selected.trip,
    rows,
  )
  const actor = useActorStore()
  const history = useTripHistoryStore()
  const receiptCurrency = computed<Currency>(
    () =>
      selected.trip.value?.currency ??
      selected.local.value?.currency ??
      actor.settings?.spendCurrency ??
      currencySchema.enum.AMD,
  )
  const name = computed(() => selected.trip.value?.place.name ?? selected.local.value?.name ?? '')
  const finished = computed(
    () =>
      selected.local.value?.completedAt ??
      selected.trip.value?.finishedOnDeviceAt ??
      selected.trip.value?.finishedAt,
  )
  const meta = computed(() => {
    const line = finished.value
      ? t('trip.history.finished_at', {
          when: new Intl.DateTimeFormat(locale.value, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(finished.value),
        })
      : t('trip.history.unfinished')
    // Recorded from a receipt (MOL-126): said beside the day, as «Записаны» says it (MOL-127).
    return selected.trip.value?.receiptId ? `${line} · ${t('receipt.recorded.from_receipt')}` : line
  })
  /**
   * «Записали N покупок» (handoff 05, 5o): the review hands the count over in the history's state
   * as it gives way to this screen (`router.replace`), so it is said once, on arrival, and a reload
   * or a «back» to here later says nothing.
   */
  const state: unknown = window.history.state
  const recorded = ref<number | null>(
    typeof state === 'object' &&
      state !== null &&
      'recorded' in state &&
      typeof state.recorded === 'number'
      ? state.recorded
      : null,
  )
  /**
   * Codes the person asked to bind that another item holds (MOL-234): said with «Записали» — the
   * purchases stand, the code went nowhere — and named by the item that has it, as MOL-100 says it.
   */
  const codesHeld = ref<CodeHeld[]>(
    typeof state === 'object' && state !== null && 'codesHeld' in state
      ? z
          .array(z.object({ code: z.string(), holder: z.string() }))
          .catch([])
          .parse(state.codesHeld)
      : [],
  )
  // Taken off the entry once read: the browser keeps an entry's state across a reload and a step
  // back and forth, and the words came back each time (review 9, adversarial А6).
  if (recorded.value !== null && typeof state === 'object' && state !== null)
    window.history.replaceState({ ...state, recorded: null, codesHeld: null }, '')
  const opened = ref<OpenedPurchase | null>(null)
  let opening = 0
  function amend(row: TripRowView): void {
    if (!row.entry) return
    const write = queue.pending.find(
      (w) => w.kind === 'add' && w.tripId === selected.id.value && w.body.id === row.key,
    )
    if (!row.expense && write?.kind !== 'add') return
    opened.value = {
      key: ++opening,
      entry: row.entry,
      expense: row.expense,
      retry:
        !row.expense && write?.kind === 'add'
          ? {
              id: write.body.id,
              quantity: write.body.quantity ?? null,
              amount: write.body.amount ?? null,
              query: write.body.query ?? null,
              missedQuery: write.body.missedQuery ?? null,
            }
          : null,
    }
  }
  const pending = computed(() => queue.pending.some((w) => w.tripId === selected.id.value))

  const removing = ref(false)
  const removal = ref<{ place: string; day: Date | null; items: number }>({
    place: '',
    day: null,
    items: 0,
  })
  /**
   * «Удалить поход» of a finished trip (MOL-76, В-1): the same as an open one's — an empty one goes
   * at once, one with purchases is asked about. Then back to where the person came from, the
   * history, the home screen or «Деньги», where «Вернуть» stands.
   */
  function drop(): void {
    const tripId = selected.id.value
    if (tripId) queue.removeTrip(tripId, name.value)
  }
  function askRemove(): void {
    const items = rows.value.filter((row) => row.mark !== 'removing').length
    if (items === 0) {
      drop()
      void goBack()
      return
    }
    removal.value = { place: name.value, day: finished.value ?? null, items }
    removing.value = true
  }
  /** The sheet puts itself and this screen away in one step back (`steps` 2). */
  const confirmRemove = drop
  /**
   * Opened cold, the screen has nothing under it to step back onto, and the sheet went alone: the
   * way back is then the chevron's.
   */
  function afterRemoveSheet(): void {
    if (route.name === 'purchase' && selected.id.value && queue.removing.has(selected.id.value))
      void goBack()
  }
  return {
    ...selected,
    t,
    name,
    meta,
    recorded,
    codesHeld,
    toVerdicts: () => void goTab('verdicts'),
    rows,
    waiting,
    receiptOpen,
    receiptWaiting,
    receiptCurrent,
    offerReceipt,
    receiptCurrency,
    receiptKnown: computed(() => history.answered(selected.trip.value)),
    opened,
    amend,
    pending,
    removing,
    removal,
    askRemove,
    confirmRemove,
    afterRemoveSheet,
    rejected: computed(() =>
      queue.rejected.some((item) => item.write.tripId === selected.id.value),
    ),
    review: toPurchases,
    close: () => {
      opened.value = null
    },
    find: () =>
      void router.push({ name: 'finished-search', params: { tripId: selected.id.value } }),
    history: toPurchases,
    load: () => void selected.load(),
  }
}
