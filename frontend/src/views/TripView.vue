<template>
  <AppScreen :title="place || t('trip.title')">
    <template v-if="meta" #subtitle>{{ meta }}</template>

    <!-- The connection, one strip first under the header (MOL-181, Ф-14), over the record the phone
         remembers and never instead of it: at a shelf that list is worth more than a red square, and
         the strip below writes through the queue either way (MOL-19, MOL-24). -->
    <template v-if="phase === 'going'">
      <StatusStrip
        v-if="trouble === 'offline'"
        class="connection"
        kind="offline"
        :text="t('trip.offline.strip')"
        :attempt="attempt"
      />
      <StatusStrip
        v-else-if="trouble === 'error'"
        class="connection"
        kind="unanswered"
        :text="t('trip.error.strip')"
        :attempt="attempt"
      >
        <template #action>
          <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
        </template>
      </StatusStrip>
    </template>

    <!-- What the queue has to say about any record, this one or another — on «Покупки» as well
         (MOL-128). Over the skeleton and the record alike, so the answer coming in under it never
         moves its buttons from under a finger (MOL-311). Its sheets, like every sheet here, ask to
         leave once they are away (Р-7). -->
    <TripNotices :ready="phase !== 'loading'" @settled="leaveIfOver" />

    <!-- The answer's shape (MOL-178, Ф-13): the rows of the record and the card of its total. -->
    <ScreenSkeleton v-if="phase === 'loading'">
      <SkeletonPart kind="rows" tail next />
      <SkeletonPart kind="figure" />
    </ScreenSkeleton>

    <template v-if="phase === 'going'">
      <TripRateNotes v-if="trip" :trip="trip" />

      <!-- The quiet circle in a card (Ф-16): on the page's ground it is not seen, and the list of the
           first purchase stands in its place. No buttons — the strip holds them (Ф-22). -->
      <AppCard v-if="rows.length === 0">
        <ScreenState
          kind="empty"
          inline
          :icon="IconBasket"
          :title="t('trip.empty.title')"
          :body="t('trip.empty.body')"
        />
      </AppCard>

      <AppCard v-else list>
        <AppReveal group>
          <TripRow v-for="row in rows" :key="row.key" :row="row" @open="amend" />
        </AppReveal>
      </AppCard>

      <!-- Under the list, with «≈» and the rate (handoff 7a, owner's В-17 «а»): the strip went to the
           actions, and the total stays the server's. With the first purchase — or with a receipt's sum
           whose purchases were all removed since, which is still the record's money (MOL-78, review 5;
           adversarial А1): the screen does not lose the one figure it has. -->
      <template v-if="rows.length > 0 || receiptCurrent">
        <TripTotalCard
          class="total"
          :trip="trip"
          :pending="waiting"
          :local="local !== null"
          :receipt-waiting="receiptWaiting"
          :rows="{ kept, unpriced }"
        />
        <p v-if="rows.length > 0" class="footnote">{{ t('trip.footnote') }}</p>
        <AppButton
          v-if="receiptAction"
          class="receipt"
          variant="ghost"
          block
          @click="receiptOpen = true"
          >{{ receiptAction }}</AppButton
        >
      </template>

      <!-- At the end of the list, one and the same on an open and a finished record, and never
           under the thumb (MOL-76, В-1). -->
      <AppButton
        class="remove"
        :class="{ alone: !receiptAction }"
        variant="danger-ghost"
        block
        @click="askRemove"
      >
        <template #icon><IconDelete /></template>
        {{ t('trip.remove.action') }}
      </AppButton>
    </template>

    <!-- The actions, one strip for an empty record and a full one, offline and on an error too —
         every one of them writes through the queue (Ф-22, handoff 7a). The main one at the right,
         under the thumb; where both words do not fit side by side the pair stands one over the
         other, «+ Позиция» nearer the thumb (owner's В-1 «в»). «Закончить» is here, not in the
         corner the thumb does not reach. -->
    <template v-if="phase === 'going'" #docked>
      <div class="pair">
        <!-- The verb out loud, the short word on the pill (review 2, №3): the glyph that says «add» or
             «scan» is hidden, and «Позиция, кнопка» says nothing of what it does. The word stays in the
             name, so a voice that says what it sees finds the button — «Новая Позиция», «Сканировать
             Штрихкод» (review 3, №3, WCAG 2.5.3). Hidden text in front, never an `aria-label`. -->
        <AppButton variant="secondary" size="large" @click="scan">
          <template #icon><IconBarcode /></template>
          <span class="hidden">{{ t('trip.scan_lead') }}</span>
          {{ t('trip.scan_short') }}
        </AppButton>
        <AppButton size="large" @click="find">
          <template #icon><IconPlus /></template>
          <span class="hidden">{{ t('trip.add_lead') }}</span>
          {{ t('trip.add_short') }}
        </AppButton>
      </div>
      <AppButton variant="ghost" block @click="askFinish">
        <template #icon><IconFlag /></template>
        {{ t('trip.finish') }}
      </AppButton>
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
        {{
          finishingEmpty
            ? t('trip.remove.empty.body')
            : askingReceipt
              ? t('trip.receipt.finish.body', finishCounts)
              : t('trip.finish_confirm.body')
        }}
      </p>
      <!-- «Сколько вышло по чеку?» — only while some purchase has no price and no sum is there yet
           (MOL-78, В-4): with every price in, the total is already known. -->
      <ReceiptField
        v-if="!finishingEmpty && askingReceipt"
        v-model="receiptText"
        v-model:currency="receiptCurrency"
        class="receipt-field"
        :label="t('trip.receipt.finish.label')"
        optional
        :bad="receiptBad"
      />
      <template #footer>
        <template v-if="finishingEmpty">
          <AppButton size="large" block @click="removeEmpty">
            {{ t('trip.remove.action') }}
          </AppButton>
          <!-- Money with no purchases is a spending (MOL-78, В-1): the record goes, «Деньги» open
               the sheet with the shop and the day in place. -->
          <AppButton variant="ghost" block @click="toSpending">
            {{ t('trip.remove.empty.spending') }}
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

    <ReceiptSheet
      v-if="tripId"
      v-model:open="receiptOpen"
      :trip-id="tripId"
      :trip-currency="currency"
      :current="receiptCurrent"
      :on-closed="leaveIfOver"
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
import IconBasket from '~icons/mdi/basket-outline'
import IconDelete from '~icons/mdi/delete-outline'
import IconFlag from '~icons/mdi/flag-checkered'
import IconPlus from '~icons/mdi/plus'
import type { CatalogueEntry, TripExpenseView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ReceiptField from '@/components/ReceiptField.vue'
import ReceiptSheet from '@/components/ReceiptSheet.vue'
import { typedReceipt } from '@/components/receipt'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import TripNotices from '@/components/TripNotices.vue'
import TripRateNotes from '@/components/TripRateNotes.vue'
import TripRemoveSheet from '@/components/TripRemoveSheet.vue'
import TripRow from '@/components/TripRow.vue'
import TripTotalCard from '@/components/TripTotalCard.vue'
import type { TripRowView } from '@/components/tripRow'
import { useTripRows } from '@/composables/useTripRows'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import type { RetryPurchase } from '@/composables/useItemDetails'
import { useReconnect } from '@/composables/useReconnect'
import { useTripReceipt } from '@/composables/useTripReceipt'
import { localDay, purchaseDay, timeOfDay } from '@/days'
import { afterStep, useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useSpendingHandoffStore } from '@/stores/spendingHandoff'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import { reportFailure } from '@/failures'

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
    AppReveal,
    AppScreen,
    BottomSheet,
    IconBarcode,
    IconDelete,
    IconFlag,
    IconPlus,
    ItemDetailsSheet,
    ReceiptField,
    ReceiptSheet,
    ScreenSkeleton,
    ScreenState,
    SkeletonPart,
    StatusStrip,
    TripNotices,
    TripRateNotes,
    TripRemoveSheet,
    TripRow,
    TripTotalCard,
  },
  setup() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const itemEntry = useItemEntryStore()
    const { goTab, goUp } = useNavigation()
    const actor = useActorStore()
    const trips = useTripStore()
    const queue = useTripQueueStore()

    const { trip, local, tripId, currency } = useCurrentTrip()

    /** Asked once at the start; the memory covers every later opening (MOL-24, Н-7). */
    const asked = ref(trips.current !== null)
    const trouble = ref<'offline' | 'error' | null>(null)
    /** Answers that failed, so a retry failing the same way is said again (MOL-181, C1). */
    const attempt = ref(0)
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
      } catch (error) {
        reportFailure(error, 'screen')
        // Which of the two it was is decided after the failure, never narrowed from a check made
        // before the request: a connection that drops mid-answer is the commonest break (MOL-19).
        trouble.value = navigator.onLine ? 'error' : 'offline'
        attempt.value += 1
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
    const { receiptOpen, receiptWaiting, receiptCurrent, receiptAction, kept, unpriced } =
      useTripReceipt(tripId, trip, rows)
    const handoff = useSpendingHandoffStore()
    /** «Записать тратой в «Деньгах»» was chosen: the screen goes there once the record is away. */
    let toMoney = false

    /**
     * Up to «Покупки» once no record is open — but never under a sheet: a sheet that closes calls
     * this again, and its own step back has to land first (`afterStep`), or the move is taken for a
     * second tap and dropped.
     */
    function leaveIfOver(): void {
      afterStep(() => {
        if (phase.value !== 'none' || document.querySelector('dialog[open]')) return
        // Handed over to «Деньги» (MOL-78, В-1): the sheet of a spending waits there. Kept for
        // every call, as the way up is: the first may come while the sheet's own step is landing.
        void (toMoney ? goTab('money') : goUp())
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
      // The sum typed into the question goes before the finish, in the queue's order (MOL-78, В-4);
      // one that is not money is said so, and nothing is sent until it is right or left empty.
      if (id && !finishingEmpty.value && askingReceipt.value && receiptText.value.trim()) {
        const receipt = typedReceipt(receiptText.value, receiptCurrency.value)
        receiptBad.value = receipt === null
        if (!receipt) return
        queue.enqueue({ kind: 'receipt', tripId: id, body: { receipt } })
      }
      if (id) queue.enqueue({ kind: 'finish', tripId: id, finishedOnDeviceAt: new Date() })
      finishing.value = false
    }

    /** Taken when «Закончить» is tapped, like `finishingEmpty`: rows arriving do not reword it. */
    const askingReceipt = ref(false)
    const finishCounts = ref({ n: 0, total: 0 })
    const receiptText = ref('')
    const receiptCurrency = ref(currency.value)
    const receiptBad = ref(false)

    function askFinish(): void {
      finishingEmpty.value = kept.value === 0 && !receiptCurrent.value
      askingReceipt.value = unpriced.value > 0 && receiptCurrent.value === null
      finishCounts.value = { n: unpriced.value, total: kept.value }
      receiptText.value = ''
      receiptCurrency.value = currency.value
      receiptBad.value = false
      finishing.value = true
    }

    /**
     * «Удалить запись»: an empty one goes at once, with «Вернуть» on «Покупки»; one with purchases
     * is asked about first, naming them (MOL-76, Р-2) — and so is one whose only money is a receipt's
     * sum, which leaves «Деньги» and the accounts with it (adversarial Б1). «Закончить» counts that sum
     * the same way: such a record is not «ничего нет».
     */
    function askRemove(): void {
      if (kept.value === 0 && !receiptCurrent.value) {
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

    /**
     * «Записать тратой в «Деньгах»» (MOL-78, В-1): the empty record goes — with «Вернуть» — and the
     * sheet of a spending opens in «Деньги» on the shop and the day of the record, in «Продукты».
     */
    function toSpending(): void {
      const since = trip.value?.startedAt ?? local.value?.startedAt ?? new Date()
      handoff.hand({ place: place.value, day: localDay(since) })
      toMoney = true
      removeEmpty()
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
      IconBasket,
      t,
      trip,
      local,
      waiting,
      phase,
      trouble,
      attempt,
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
      toSpending,
      askingReceipt,
      finishCounts,
      receiptText,
      receiptCurrency,
      receiptBad,
      receiptOpen,
      receiptWaiting,
      receiptCurrent,
      receiptAction,
      kept,
      unpriced,
      tripId,
      currency,
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
.confirm {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.receipt-field {
  margin-top: var(--space-4);
}

// 8 to the card it stands over, as the handoff's 2b draws it.
.connection {
  margin-bottom: var(--space-2);
}

/* Side by side where both words fit, one over the other where they do not, the main one under: each
   at least its word, the two equal on a line (owner's В-1 «в»). By the words, not by a width, so a
   language longer than Russian takes the same way. */
.pair {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);

  /* Half the line each by the outer box — a basis of 0 left the secondary's edge out, and the pair
     came 2 px apart — and never narrower than its word, which is what sends one under the other. */
  > * {
    flex: 1 0 calc((100% - var(--space-2)) / 2);
    min-width: max-content;
  }
}

.total {
  margin-top: var(--space-2);
}

.hidden {
  @include visually-hidden;
}

.footnote {
  margin: var(--space-3) var(--space-1) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.receipt {
  margin-top: var(--space-6);
}

/* 8 under «+ Сумма по чеку», 24 under a card where there is none (handoffs 7a and 77 v2). */
.remove {
  margin-top: var(--space-2);

  &.alone {
    margin-top: var(--space-6);
  }
}
</style>
