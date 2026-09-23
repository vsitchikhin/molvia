import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { SelectedTrip } from './useSelectedTrip'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { CatalogueEntry, TripExpenseView } from '@molvia/model'
import type { TripRowView } from '@/components/tripRow'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { RetryPurchase } from './useItemDetails'
import { useSelectedTrip } from './useSelectedTrip'
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
  rows: ComputedRef<TripRowView[]>
  waiting: ComputedRef<number>
  opened: Ref<OpenedPurchase | null>
  pending: ComputedRef<boolean>
  rejected: ComputedRef<boolean>
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
  const selected = useSelectedTrip(() =>
    typeof route.params.tripId === 'string' ? route.params.tripId : null,
  )
  const { rows, waiting } = useTripRows(selected.id, selected.trip, () => t('trip.queued.unnamed'))
  const name = computed(() => selected.trip.value?.place.name ?? selected.local.value?.name ?? '')
  const finished = computed(
    () =>
      selected.local.value?.completedAt ??
      selected.trip.value?.finishedOnDeviceAt ??
      selected.trip.value?.finishedAt,
  )
  const meta = computed(() =>
    finished.value
      ? t('trip.history.finished_at', {
          when: new Intl.DateTimeFormat(locale.value, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(finished.value),
        })
      : t('trip.history.unfinished'),
  )
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
            }
          : null,
    }
  }
  const pending = computed(() => queue.pending.some((w) => w.tripId === selected.id.value))
  return {
    ...selected,
    t,
    name,
    meta,
    rows,
    waiting,
    opened,
    amend,
    pending,
    rejected: computed(() =>
      queue.rejected.some((item) => item.write.tripId === selected.id.value),
    ),
    review: () => void router.push({ name: 'trip' }),
    close: () => {
      opened.value = null
    },
    find: () =>
      void router.push({ name: 'finished-search', params: { tripId: selected.id.value } }),
    history: () => void router.replace({ name: 'trip-history' }),
    load: () => void selected.load(),
  }
}
