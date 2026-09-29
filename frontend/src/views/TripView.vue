<template>
  <AppScreen :title="place || t('trip.title')">
    <template v-if="meta" #subtitle>{{ meta }}</template>

    <template v-if="phase === 'going'" #trailing>
      <button class="finish" type="button" @click="askFinish">{{ t('trip.finish') }}</button>
    </template>

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[72, 54, 84, 46]" />

    <template v-else>
      <!-- Over whatever the screen shows, never instead of it: at a shelf the list the phone
           remembers is worth more than a red square, and the purchases are all still there
           (MOL-19). -->
      <ScreenState
        v-if="trouble === 'offline'"
        class="notice"
        kind="offline"
        tone="good"
        inline
        :title="t('trip.offline.title')"
        :body="t('trip.offline.body')"
      />
      <ScreenState
        v-else-if="trouble === 'error'"
        class="notice"
        kind="error"
        inline
        :title="t('trip.error.title')"
        :body="t('trip.error.body')"
        @retry="retry"
      />
    </template>

    <!-- What the queue has to say about any record, this one or another — on «Покупки» as well
         (MOL-128). Its sheets, like every sheet here, ask to leave once they are away (Р-7). -->
    <TripNotices :ready="phase !== 'loading'" @settled="leaveIfOver" />

    <template v-if="phase === 'going'">
      <TripRateNotes v-if="trip" :trip="trip" />

      <!-- No circle: over «Найти товар» it read as a button of its own, and was tapped (MOL-77). -->
      <ScreenState
        v-if="rows.length === 0"
        kind="empty"
        tone="accent"
        :title="t('trip.empty.title')"
        :body="t('trip.empty.body')"
      >
        <template #action>
          <AppButton size="large" block @click="find">{{ t('trip.empty.action') }}</AppButton>
          <AppButton variant="secondary" block @click="scan">
            <template #icon><IconBarcode /></template>
            {{ t('item.barcode.scan') }}
          </AppButton>
        </template>
      </ScreenState>

      <template v-else>
        <AppCard list>
          <TripRow v-for="row in rows" :key="row.key" :row="row" @open="amend" />
          <button class="add" type="button" @click="find">
            <IconPlus class="add-icon" aria-hidden="true" />
            {{ t('trip.add_item') }}
          </button>
          <button class="add" type="button" @click="scan">
            <IconBarcode class="add-icon" aria-hidden="true" />
            {{ t('item.barcode.scan') }}
          </button>
        </AppCard>
        <p class="footnote">{{ t('trip.footnote') }}</p>
      </template>

      <!-- At the end of the list, one and the same on an open and a finished record, and never
           under the thumb (MOL-76, В-1). -->
      <AppButton class="remove" variant="danger-ghost" block @click="askRemove">{{
        t('trip.remove.action')
      }}</AppButton>
    </template>

    <!-- The one permanent place money is converted, and it stays put while the list scrolls. -->
    <template v-if="phase === 'going'" #docked>
      <TripTotal :trip="trip" :pending="waiting" :local="local !== null" />
    </template>

    <!-- Asked before, not undone after: a record cannot be reopened in 0.1, and «Закончить» is one
         tap away from «Добавить позицию». An empty one finished is a row of nothing in «Покупки»
         for good: it is offered to go instead, and finishing it stays the second action (MOL-76,
         В-2). Away, the screen goes up to «Покупки» — there is nothing left on it. -->
    <BottomSheet v-model:open="finishing" :on-closed="leaveIfOver">
      <template #title>{{
        finishingEmpty ? t('trip.remove.empty.title') : t('trip.finish_confirm.title')
      }}</template>
      <p class="confirm">
        {{ finishingEmpty ? t('trip.remove.empty.body') : t('trip.finish_confirm.body') }}
      </p>
      <template #footer>
        <template v-if="finishingEmpty">
          <AppButton size="large" block @click="removeEmpty">
            {{ t('trip.remove.action') }}
          </AppButton>
          <AppButton variant="ghost" block @click="finish">
            {{ t('trip.remove.empty.finish') }}
          </AppButton>
        </template>
        <template v-else>
          <AppButton size="large" block @click="finish">
            {{ t('trip.finish_confirm.ok') }}
          </AppButton>
          <AppButton variant="ghost" block @click="finishing = false">
            {{ t('trip.finish_confirm.cancel') }}
          </AppButton>
        </template>
      </template>
    </BottomSheet>

    <TripRemoveSheet
      v-model:open="removing"
      :place="removal.place"
      :day="removal.day"
      :items="removal.items"
      :on-closed="leaveIfOver"
      @confirm="remove"
    />

    <!-- Mounted on a tap and put away from `onClosed`, as the search does it: one opening, one
         purchase. One step back — the record is the screen under it. -->
    <ItemDetailsSheet
      v-if="opened"
      :key="opened.key"
      :entry="opened.entry"
      :expense="opened.expense"
      :trip-id="opened.tripId"
      :retry="opened.retry"
      :close-steps="1"
      :on-closed="putAway"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconBarcode from '~icons/mdi/barcode-scan'
import IconPlus from '~icons/mdi/plus'
import type { CatalogueEntry, TripExpenseView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripNotices from '@/components/TripNotices.vue'
import TripRateNotes from '@/components/TripRateNotes.vue'
import TripRemoveSheet from '@/components/TripRemoveSheet.vue'
import TripRow from '@/components/TripRow.vue'
import TripTotal from '@/components/TripTotal.vue'
import type { TripRowView } from '@/components/tripRow'
import { useTripRows } from '@/composables/useTripRows'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import type { RetryPurchase } from '@/composables/useItemDetails'
import { useReconnect } from '@/composables/useReconnect'
import { purchaseDay, timeOfDay } from '@/days'
import { afterStep, useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'

/** What the sheet is open on: a row being amended. */
interface Opened {
  readonly key: string
  readonly entry: CatalogueEntry
  readonly expense: TripExpenseView | null
  /** The trip the row belongs to, which is not always the one going on now. */
  readonly tripId: string | null
  readonly retry: RetryPurchase | null
}

/**
 * The record typed by hand (MOL-128) — the screen that was «Поход» with a trip going on: what is
 * in the basket, what it costs, and one tap to the next purchase. A screen under «Покупки» now,
 * called by its place; the rules of writing are MOL-21, MOL-24 and MOL-25, unchanged.
 *
 * **Nothing is added up here** (MOL-24, В-11). The list, the price per unit of every row and the
 * total are the server's; the one number the phone computes is the price per unit of a purchase
 * the server has not answered yet, with the domain's own `unitPrice`, because at a shelf that
 * number is needed now.
 *
 * **The trip is the queue's as much as the store's** (Р-2): started or finished with no signal,
 * it exists on the phone before the server hears about it, and the screen draws it either way.
 * A failure to reach the server is a notice above the list, never in place of it.
 *
 * **With no record open the screen goes up to «Покупки»** — finished here or on another device,
 * removed, or opened by an old address: there is nothing left on it, and «Покупки» is where a new
 * one starts and where «Вернуть» stands.
 */
export default defineComponent({
  name: 'TripView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    BottomSheet,
    IconBarcode,
    IconPlus,
    ItemDetailsSheet,
    ScreenSkeleton,
    ScreenState,
    TripNotices,
    TripRateNotes,
    TripRemoveSheet,
    TripRow,
    TripTotal,
  },
  setup() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const itemEntry = useItemEntryStore()
    const { goUp } = useNavigation()
    const actor = useActorStore()
    const trips = useTripStore()
    const queue = useTripQueueStore()

    const { trip, local, tripId } = useCurrentTrip()

    /** Asked once at the start; the memory covers every later opening (MOL-24, Н-7). */
    const asked = ref(trips.current !== null)
    const trouble = ref<'offline' | 'error' | null>(null)
    const finishing = ref(false)
    /** Taken when «Закончить» is tapped: a row arriving while the sheet is up does not reword it. */
    const finishingEmpty = ref(false)
    const removing = ref(false)
    /** What the question names, taken when it is asked (MOL-76, Р-2). */
    const removal = ref<{ place: string; day: Date | null; items: number }>({
      place: '',
      day: null,
      items: 0,
    })

    async function load(): Promise<void> {
      // No identity yet — the first launch is still making one, and there is nothing to ask for
      // (MOL-28 does the same). A red «the server did not answer» before the app has an identity
      // would be about the app's own start, not about the network.
      if (!actor.id) return
      try {
        await trips.load()
        trouble.value = null
      } catch {
        // Which of the two it was is decided after the failure, never narrowed from a check made
        // before the request: a connection that drops mid-answer is the commonest break (MOL-19).
        trouble.value = navigator.onLine ? 'error' : 'offline'
      } finally {
        asked.value = true
      }
    }

    const phase = computed(() => {
      if ((!asked.value || !actor.id) && tripId.value === null) return 'loading'
      return tripId.value === null ? 'none' : 'going'
    })

    const place = computed(() => trip.value?.place.name ?? local.value?.placeName ?? '')

    /** «Записываете вручную · сегодня, с 18:40» (handoff `07`). */
    const meta = computed(() => {
      const since = trip.value?.startedAt ?? local.value?.startedAt
      return since
        ? t('trip.manual_meta', {
            when: t('trip.manual_since', {
              day: purchaseDay(since, locale.value),
              time: timeOfDay(since, locale.value),
            }),
          })
        : null
    })

    const { rows, waiting } = useTripRows(tripId, trip, () => t('trip.queued.unnamed'))

    /**
     * Up to «Покупки» once no record is open — but never under a sheet: a sheet that closes calls
     * this again, and its own step back has to land first (`afterStep`), or the move is taken for a
     * second tap and dropped.
     */
    function leaveIfOver(): void {
      afterStep(() => {
        if (phase.value !== 'none' || document.querySelector('dialog[open]')) return
        void goUp()
      })
    }
    watch(phase, (now) => {
      if (now === 'none') void nextTick(leaveIfOver)
    })

    const opened = ref<Opened | null>(null)
    let openings = 0

    /**
     * A row the server has answered opens as an amendment of that row, **of its own trip**: the
     * current one may have changed under the sheet — finished on another device — and the edit
     * would then be addressed to a trip the row is not in (review 8).
     *
     * A purchase still in the queue has no row to amend. It opens as itself — the same purchase
     * identifier, the numbers as typed — and goes back into the queue in place of what is there
     * (review 1): opened as a new purchase it became a second row on the server.
     */
    function amend(row: TripRowView): void {
      if (!row.entry) return
      // A waiting line whose write has just gone: opened as a purchase it would be a new one,
      // with a new identifier, and «Сохранить» would write the same thing twice (Т-10).
      const purchase = row.expense ? null : queuedPurchase(row.key)
      if (!row.expense && !purchase) return
      openings += 1
      opened.value = {
        key: `amend-${row.key}-${String(openings)}`,
        entry: row.entry,
        expense: row.expense,
        tripId: row.expense ? (trip.value?.id ?? null) : tripId.value,
        retry: purchase,
      }
    }

    /** A purchase still in the queue, as the sheet takes it back: numbers and the query with it. */
    function queuedPurchase(id: string): RetryPurchase | null {
      const write = queue.pending.find(
        (item) => item.kind === 'add' && item.body.id === id && item.tripId === tripId.value,
      )
      if (write?.kind !== 'add') return null
      return {
        id,
        quantity: write.body.quantity ?? null,
        amount: write.body.amount ?? null,
        query: write.body.query ?? null,
        missedQuery: write.body.missedQuery ?? null,
      }
    }

    /**
     * The record is over on the phone the moment it is asked for: the write goes into the queue
     * behind every purchase of it, so «закончить» reaches the server last (MOL-22, В-1).
     */
    function finish(): void {
      const id = tripId.value
      if (id) queue.enqueue({ kind: 'finish', tripId: id, finishedOnDeviceAt: new Date() })
      finishing.value = false
    }

    /**
     * The rows still on screen: one being removed is on its way out already. One count for both
     * questions, or «Закончить» and «Удалить запись» called one record empty and not (review Р-5).
     */
    const kept = computed(() => rows.value.filter((row) => row.mark !== 'removing').length)

    function askFinish(): void {
      finishingEmpty.value = kept.value === 0
      finishing.value = true
    }

    /**
     * «Удалить запись»: an empty one goes at once, with «Вернуть» on «Покупки»; one with purchases
     * is asked about first, naming them (MOL-76, Р-2).
     */
    function askRemove(): void {
      if (kept.value === 0) {
        remove()
        return
      }
      removal.value = {
        place: place.value,
        day: trip.value?.startedAt ?? local.value?.startedAt ?? null,
        items: kept.value,
      }
      removing.value = true
    }

    function remove(): void {
      const id = tripId.value
      if (id) queue.removeTrip(id, place.value)
      removing.value = false
    }

    function removeEmpty(): void {
      remove()
      finishing.value = false
    }

    /** A nested screen, so an ordinary push: «back» from it lands on the record (MOL-17). */
    function find(): void {
      void router.push({ name: 'item-search' })
    }

    /** «Сканировать» (MOL-99, В-4): the same screen, with the scanner up over it at once. */
    function scan(): void {
      itemEntry.askToScan()
      find()
    }

    useReconnect(() => {
      if (trouble.value) void load()
    })

    // The identity arrives a moment after the first launch, and the trip is asked for then.
    watch(
      () => actor.id,
      (id) => {
        if (id) void load()
      },
    )

    onMounted(() => {
      void load()
      // Opened with nothing to show — an old address, a record finished on another device and
      // already known here.
      leaveIfOver()
    })

    return {
      t,
      trip,
      local,
      waiting,
      phase,
      trouble,
      place,
      meta,
      rows,
      opened,
      finishing,
      finishingEmpty,
      askFinish,
      finish,
      removing,
      removal,
      askRemove,
      remove,
      removeEmpty,
      leaveIfOver,
      retry: () => void load(),
      amend,
      // The record may have ended under the sheet — finished on another phone, its purchase's answer
      // carrying `finishedAt` — and nothing else would take the screen up then (review Р-7).
      putAway: () => {
        opened.value = null
        leaveIfOver()
      },
      find,
      scan,
    }
  },
})
</script>

<style scoped lang="scss">
.finish {
  @include touch-target;

  /* Its optical edge lines up with the field below, not its box (handoff). */
  margin-right: calc(var(--space-2) * -1);
  padding: 0 var(--space-2);
  border: none;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;

    border-radius: var(--radius-sm);
  }
}

.confirm {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.notice {
  margin-bottom: var(--space-3);
}

.add {
  @include touch-target;

  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4);
  border: none;
  background: none;
  color: var(--accent-ink);
  font: inherit;
  font-size: var(--text-body);
  font-weight: var(--weight-medium);
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
  }
}

.add-icon {
  flex: none;
  width: 1.375rem;
  height: 1.375rem;
}

.remove {
  margin-top: var(--space-6);
}

.footnote {
  margin: var(--space-3) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
