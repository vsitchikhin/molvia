<template>
  <AppScreen :title="t('trip.title')">
    <template v-if="meta" #meta>{{ meta }}</template>

    <template v-if="phase === 'going'" #trailing>
      <button class="finish" type="button" @click="finishing = true">{{ t('trip.finish') }}</button>
    </template>

    <ScreenSkeleton v-if="phase === 'loading'" :groups="[72, 54, 84, 46]" />

    <template v-else>
      <!-- Over whatever the screen shows, never instead of it: at a shelf the list the phone
           remembers is worth more than a red square, and the purchases are all still there
           (MOL-19). Above «Новый поход» too — otherwise a trip the server holds but could not be
           asked for reads as «no trip at all». -->
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
        @retry="load"
      />
    </template>

    <!-- A purchase the server refused: what it was, why, and a way to correct it. Shown whatever
         else is on the screen, and for every trip, not only the one going on — a purchase that was
         never recorded does not stop mattering when its trip is finished (MOL-22, В-3, review 2). -->
    <ScreenState
      v-for="item in rejected"
      :key="refusalKey(item)"
      class="notice"
      kind="attention"
      inline
      :title="refusalTitle(item)"
      :body="refusalReason(item)"
    >
      <template #action>
        <div class="refusal-actions">
          <AppButton v-if="correctable(item)" variant="ghost" @click="correct(item)">
            {{ t('trip.rejected.fix') }}
          </AppButton>
          <AppButton variant="ghost" @click="queue.dismiss(item)">
            {{ t('trip.rejected.drop') }}
          </AppButton>
        </div>
      </template>
    </ScreenState>

    <!-- A trip is open in another shop: the purchases wait rather than move there by themselves,
         because «item + place» is the key the product rests on. The choice is the person's
         (adversarial Б1, owner's decision). -->
    <ScreenState
      v-if="queue.elsewhere"
      class="notice"
      kind="attention"
      inline
      :title="t('trip.elsewhere.title', { place: queue.elsewhere.place })"
      :body="t('trip.elsewhere.body', { mine: queue.elsewhere.mine })"
    >
      <template #action>
        <div class="refusal-actions">
          <AppButton variant="ghost" @click="queue.joinElsewhere()">
            {{ t('trip.elsewhere.join', { place: queue.elsewhere.place }) }}
          </AppButton>
          <AppButton variant="ghost" @click="queue.finishElsewhere()">
            {{ t('trip.elsewhere.finish') }}
          </AppButton>
        </div>
      </template>
    </ScreenState>

    <!-- Finished with no signal: the trip is over on the phone, and what it still holds must not
         go quiet with it — on iOS nothing is sent in the background, and an app that was closed
         here would never say a word (adversarial В1). -->
    <ScreenState
      v-if="phase !== 'going' && unsent > 0"
      class="notice"
      kind="attention"
      inline
      :title="t('trip.unsent.title', { n: unsent }, unsent)"
      :body="t('trip.unsent.body')"
    />

    <template v-if="phase === 'none'">
      <ScreenState
        kind="empty"
        tone="accent"
        :icon="IconPlus"
        :title="t('trip.none.title')"
        :body="t('trip.none.body')"
      >
        <template #action>
          <AppButton size="large" block @click="starting = true">
            {{ t('trip.none.action') }}
          </AppButton>
        </template>
      </ScreenState>
    </template>

    <template v-else-if="phase === 'going'">
      <TripRateNotes v-if="trip" :trip="trip" />

      <ScreenState
        v-if="rows.length === 0"
        kind="empty"
        tone="accent"
        :icon="IconPlus"
        :title="t('trip.empty.title')"
        :body="t('trip.empty.body')"
      >
        <template #action>
          <AppButton size="large" block @click="find">{{ t('trip.empty.action') }}</AppButton>
        </template>
      </ScreenState>

      <template v-else>
        <AppCard list>
          <TripRow v-for="row in rows" :key="row.key" :row="row" @open="amend" />
          <button class="add" type="button" @click="find">
            <IconPlus class="add-icon" aria-hidden="true" />
            {{ t('trip.add_item') }}
          </button>
        </AppCard>
        <p class="footnote">{{ t('trip.footnote') }}</p>
      </template>
    </template>

    <!-- The one permanent place money is converted, and it stays put while the list scrolls. -->
    <!-- On the skeleton too, with a dash for the sum: the strip is part of the frame, and a screen
         that grows it after the answer jumps under the thumb (требования §5, В2-7). -->
    <template v-if="phase !== 'none'" #docked>
      <TripTotal :trip="trip" :pending="waiting" :local="local !== null" />
    </template>

    <!-- Mounted always and led by `open`, as «Предложить товар» is: under a `v-if` the sheet
         would be gone before it could step back off its own history entry (MOL-18; review 5). -->
    <StartTripSheet v-model:open="starting" />

    <!-- Asked before, not undone after: a trip cannot be reopened in 0.1, and «Завершить» is one
         tap away from «Добавить позицию». -->
    <BottomSheet v-model:open="finishing">
      <template #title>{{ t('trip.finish_confirm.title') }}</template>
      <p class="confirm">{{ t('trip.finish_confirm.body') }}</p>
      <template #footer>
        <AppButton size="large" block @click="finish">
          {{ t('trip.finish_confirm.ok') }}
        </AppButton>
        <AppButton variant="ghost" block @click="finishing = false">
          {{ t('trip.finish_confirm.cancel') }}
        </AppButton>
      </template>
    </BottomSheet>

    <!-- Mounted on a tap and put away from `onClosed`, as the search does it: one opening, one
         purchase. One step back — the trip is the screen under it. -->
    <ItemDetailsSheet
      v-if="opened"
      :key="opened.key"
      :entry="opened.entry"
      :expense="opened.expense"
      :trip-id="opened.tripId"
      :retry="opened.retry"
      :close-steps="1"
      :on-closed="putAway"
      @added="corrected"
    />
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconPlus from '~icons/mdi/plus'
import { unitPrice } from '@molvia/model'
import type { CatalogueEntry, TripExpenseView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import StartTripSheet from '@/components/StartTripSheet.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripRateNotes from '@/components/TripRateNotes.vue'
import TripRow from '@/components/TripRow.vue'
import TripTotal from '@/components/TripTotal.vue'
import type { RowMark, TripRowView } from '@/components/tripRow'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import type { RetryPurchase } from '@/composables/useItemDetails'
import { useReconnect } from '@/composables/useReconnect'
import { purchaseDay } from '@/days'
import { useActorStore } from '@/stores/actor'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import type { QueuedWrite, RejectedWrite } from '@/stores/tripQueue'

/** What the sheet is open on: a row being amended, or a refused purchase being corrected. */
interface Opened {
  readonly key: string
  readonly entry: CatalogueEntry
  readonly expense: TripExpenseView | null
  /** The trip the row belongs to, which is not always the one going on now. */
  readonly tripId: string | null
  readonly retry: RetryPurchase | null
  readonly refusal: RejectedWrite | null
}

/**
 * «Поход» — the screen the product is built around: what is in the basket, what it costs, and
 * one tap to the next purchase.
 *
 * **Nothing is added up here** (MOL-24, В-11). The list, the price per unit of every row and the
 * total are the server's; the one number the phone computes is the price per unit of a purchase
 * the server has not answered yet, with the domain's own `unitPrice`, because at a shelf that
 * number is needed now.
 *
 * **The trip is the queue's as much as the store's** (Р-2): started or finished with no signal,
 * it exists on the phone before the server hears about it, and the screen draws it either way.
 * A failure to reach the server is a notice above the list, never in place of it: the purchases
 * are on the phone and the trip goes on.
 */
export default defineComponent({
  name: 'TripView',
  components: {
    AppButton,
    AppCard,
    AppScreen,
    BottomSheet,
    IconPlus,
    ItemDetailsSheet,
    ScreenSkeleton,
    ScreenState,
    StartTripSheet,
    TripRateNotes,
    TripRow,
    TripTotal,
  },
  setup() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const actor = useActorStore()
    const trips = useTripStore()
    const queue = useTripQueueStore()
    const { trip, local, tripId } = useCurrentTrip()

    /** Asked once at the start; the memory covers every later opening (MOL-24, Н-7). */
    const asked = ref(trips.current !== null)
    const trouble = ref<'offline' | 'error' | null>(null)
    const starting = ref(false)
    const finishing = ref(false)

    async function load(): Promise<void> {
      // No identity yet — the first launch is still making one, and there is nothing to ask for
      // (MOL-28 does the same). A red «the server did not answer» before the app has an identity
      // would be about the app's own start, not about the network; the identity notice above says
      // what is happening.
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

    const meta = computed(() => {
      const place = trip.value?.place.name ?? local.value?.placeName
      const when = trip.value?.startedAt ?? local.value?.startedAt
      return place && when
        ? t('trip.at_place', { place, when: purchaseDay(when, locale.value) })
        : null
    })

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
      const server = (trip.value?.expenses ?? []).map((expense): TripRowView => ({
        key: expense.id,
        name: expense.item.name,
        quantity: expense.quantity,
        amount: expense.amount,
        unitPrice: expense.unitPrice,
        mark: held.value.marks.get(expense.id) ?? null,
        entry: expense.item,
        expense,
      }))
      const written = new Set(server.map((row) => row.key))
      const queued = held.value.added.flatMap((write): TripRowView[] =>
        // The server answered it while the queue still holds the write — the connection dropped
        // between the write and its answer. One purchase, one line (В2-2).
        write.kind === 'add' && !written.has(write.body.id)
          ? [
              {
                key: write.body.id,
                name: write.entry?.name ?? t('trip.queued.unnamed'),
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

    /**
     * Purchases of this trip the server has not taken yet — exactly what the total is missing
     * (review 6). An edit or a removal also leaves it behind, but by no whole item, and «+1
     * позиция ещё не ушла» about a row being deleted would be the wrong direction.
     */
    const waiting = computed(() => rows.value.filter((row) => row.mark === 'waiting').length)

    const rejected = computed(() => queue.rejected)

    /** Writes of any trip the server has not taken: after «Завершить» they are all there is left. */
    const unsent = computed(() => queue.pending.filter((write) => write.kind === 'add').length)

    // Its own name on the phone: two refusals about one row differ in nothing a screen can see,
    // and Vue would reuse one's node for the other (review 7, В2-8).
    const refusalKey = (item: RejectedWrite): string => item.key

    /**
     * What to call the refused write. A purchase carries its own card; an amendment or a removal
     * is named by the row it is about — and only while that row is on screen. A refusal from a
     * trip that is over stays nameless (В2-9): the row is not there to ask, and inventing a name
     * is worse than «одна запись».
     */
    function nameOf(item: RejectedWrite): string | null {
      const write = item.write
      if (write.kind === 'add') return write.entry?.name ?? null
      if (!('expenseId' in write)) return null
      const expense = trip.value?.expenses.find((row) => row.id === write.expenseId)
      return expense?.item.name ?? null
    }

    const refusalTitle = (item: RejectedWrite): string => {
      const name = nameOf(item)
      return name ? t('trip.rejected.named', { name }) : t('trip.rejected.title')
    }

    /**
     * Why it was refused, in the person's words where the dictionary has them. A code from the
     * `issue.*` half is a fault of the app rather than of what was typed: it is named plainly and
     * carried as the code itself, which is what a report needs.
     */
    const refusalReason = (item: RejectedWrite): string => {
      const key = item.code.startsWith('error.') ? item.code : null
      return key ? t(key) : t('trip.rejected.unknown', { code: item.code })
    }

    /** Only a purchase can be corrected, and only one whose card the phone can still read. */
    const correctable = (item: RejectedWrite): boolean =>
      item.write.kind === 'add' && item.write.entry !== null

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
      openings += 1
      opened.value = {
        key: `amend-${row.key}-${String(openings)}`,
        entry: row.entry,
        expense: row.expense,
        tripId: row.expense ? (trip.value?.id ?? null) : tripId.value,
        retry: row.expense ? null : queuedPurchase(row.key),
        refusal: null,
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
      }
    }

    function correct(item: RejectedWrite): void {
      const write = item.write
      if (write.kind !== 'add' || !write.entry) return
      openings += 1
      opened.value = {
        key: `fix-${write.body.id}-${String(openings)}`,
        entry: write.entry,
        expense: null,
        tripId: write.tripId,
        // The purchase keeps its own identifier: the server never took it, so it cannot meet
        // a second copy of itself.
        retry: {
          id: write.body.id,
          quantity: write.body.quantity ?? null,
          amount: write.body.amount ?? null,
          query: write.body.query ?? null,
        },
        refusal: item,
      }
    }

    /** The corrected purchase is queued first, and only then the refusal is forgotten. */
    function corrected(): void {
      const refusal = opened.value?.refusal
      if (refusal) queue.dismiss(refusal)
    }

    /**
     * The trip is over on the phone the moment it is asked for: the write goes into the queue
     * behind every purchase of this trip, so «завершить» reaches the server last (MOL-22, В-1).
     */
    function finish(): void {
      const id = tripId.value
      if (id) queue.enqueue({ kind: 'finish', tripId: id })
      finishing.value = false
    }

    function putAway(): void {
      opened.value = null
    }

    /** A nested screen, so an ordinary push: «back» from it lands on the trip (MOL-17). */
    function find(): void {
      void router.push({ name: 'item-search' })
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
    })

    return {
      t,
      IconPlus,
      queue,
      trip,
      local,
      waiting,
      phase,
      trouble,
      meta,
      rows,
      rejected,
      unsent,
      opened,
      starting,
      finishing,
      finish,
      load: () => void load(),
      refusalKey,
      refusalTitle,
      refusalReason,
      correctable,
      correct,
      corrected,
      amend,
      putAway,
      find,
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

.refusal-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: center;
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

.footnote {
  margin: var(--space-3) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
