<template>
  <AppScreen :title="t('purchases.title')">
    <TripNotices :ready="asked" />

    <!-- The record going on comes first, without a caption: it is the one thing on this screen
         that is still being done (handoff `03`, Р-4). From the phone as much as from the server —
         a record started with no signal is open all the same. -->
    <AppReveal>
      <AppCard v-if="open" class="block open" list>
        <PurchaseRow
          :icon="IconPencil"
          accent
          :title="open.place"
          :meta="t('purchases.open_manual_meta', { count: positions(open.count) })"
          :tag="t('purchases.continue')"
          @open="goOn"
        />
      </AppCard>
    </AppReveal>

    <AppReveal>
      <AppCard v-if="pending > 0 && !country" class="block pending" list>
        <PurchaseRow
          :icon="IconStar"
          accent
          :title="t('verdict.pending_count', { n: pending }, pending)"
          :meta="pendingFrom"
          @open="goTab('verdicts')"
        />
      </AppCard>
    </AppReveal>

    <!-- Receipts (MOL-127, handoff 03): in work, then to look at and record — each section only
         when it has a row. -->
    <template v-if="working.length > 0">
      <p class="caption">{{ t('purchases.group_working') }}</p>
      <AppCard class="block" list>
        <AppReveal group>
          <PurchaseRow
            v-for="row in working"
            :key="row.id"
            :icon="iconOf(row)"
            :class="{ breathing: row.state === 'parsing' && receipts.online.value }"
            :warn="row.state === 'rejected'"
            :title="receiptTitle(row)"
            :meta="receiptMeta(row)"
            :tag="row.state === 'rejected' ? t('purchases.remove') : null"
            @open="openReceipt(row)"
          />
        </AppReveal>
      </AppCard>
    </template>
    <template v-if="review.length > 0">
      <p class="caption">{{ t('purchases.group_review') }}</p>
      <AppCard class="block" list>
        <AppReveal group>
          <PurchaseRow
            v-for="row in review"
            :key="row.id"
            :icon="iconOf(row)"
            :warn="row.state === 'failed'"
            :title="receiptTitle(row)"
            :meta="receiptMeta(row)"
            :note="receiptNote(row)"
            :sum="receiptSum(row)"
            @open="openReceipt(row)"
          />
        </AppReveal>
      </AppCard>
    </template>

    <AppReveal>
      <AppCard v-if="pending > 0 && country" class="block pending" list>
        <PurchaseRow
          :icon="IconStar"
          :title="t('verdict.pending_count', { n: pending }, pending)"
          :meta="pendingFrom"
          @open="goTab('verdicts')"
        />
      </AppCard>
    </AppReveal>

    <ScreenSkeleton v-if="shown === 'loading'" :groups="[34, 70, 56, 74, 62]" />

    <!-- No circle and no button: the action is in the strip below, and a circle over it read as
         a button of its own (MOL-77). Only for a history known to be empty (`answeredEmpty`). -->
    <ScreenState
      v-else-if="shown === 'empty'"
      kind="empty"
      tone="accent"
      :title="t('purchases.empty.title')"
      :body="t(country ? 'purchases.empty_capture.body' : 'purchases.empty.body')"
    />

    <ScreenState
      v-if="trouble === 'error'"
      kind="error"
      :inline="rows.length > 0 || !!open || receiptRows.length > 0"
      :title="t('purchases.error.title')"
      :body="t(country ? 'purchases.error_capture' : 'purchases.error.body')"
      @retry="retry"
    />
    <ScreenState
      v-else-if="trouble === 'offline'"
      kind="offline"
      tone="warn"
      :inline="rows.length > 0 || !!open || receiptRows.length > 0"
      :title="t('trip.history.offline_title')"
      :body="t('trip.history.offline_body')"
    />
    <p v-if="history.stale && rows.length > 0" class="memory">{{ t('trip.history.cached') }}</p>

    <template v-if="rows.length > 0">
      <p class="caption">{{ t('purchases.group_recorded') }}</p>
      <AppCard class="recorded" list>
        <AppReveal group>
          <PurchaseRow
            v-for="row in rows"
            :key="row.id"
            :title="row.name"
            :meta="recordedMeta(row)"
            :note="row.pending ? t('trip.history.local_finish') : null"
            :sum="sum(row)"
            @open="openRow(row.id)"
          />
        </AppReveal>
      </AppCard>
      <AppButton
        v-if="history.page.nextCursor && trouble !== 'offline'"
        class="more"
        variant="ghost"
        :disabled="loading"
        @click="more"
        >{{ t('trip.history.more') }}</AppButton
      >
    </template>

    <ReceiptWorkSheet
      v-model:open="working_open"
      :row="workRow"
      :title="workRow ? receiptTitle(workRow) : ''"
      :meta="workRow ? receiptMeta(workRow) : null"
    />

    <!-- The action under the thumb in every state, loading and failure included: a record goes
         through the queue and needs neither the list nor the network (MOL-77). «Вернуть» of a
         record removed from its own screen stands above it (MOL-76). -->
    <template #docked>
      <div class="strip">
        <TripUndoStrip class="undo" />
        <template v-if="country">
          <ReceiptUndoStrip class="undo" />
          <ReceiptSentLine class="undo" />
          <CaptureButton :country="country" />
          <ManualEntryButton by-hand class="by-hand" />
        </template>
        <ManualEntryButton v-else />
      </div>
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconPencil from '~icons/mdi/pencil-outline'
import IconStar from '~icons/mdi/star-outline'
import IconCloudUpload from '~icons/mdi/cloud-upload-outline'
import IconFileAlert from '~icons/mdi/file-alert-outline'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import IconSync from '~icons/mdi/sync'
import { formatMoney } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import CaptureButton from '@/components/CaptureButton.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import PurchaseRow from '@/components/PurchaseRow.vue'
import ReceiptSentLine from '@/components/ReceiptSentLine.vue'
import ReceiptUndoStrip from '@/components/ReceiptUndoStrip.vue'
import ReceiptWorkSheet from '@/components/ReceiptWorkSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripNotices from '@/components/TripNotices.vue'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { usePendingFrom } from '@/composables/usePendingFrom'
import { useReceiptCapture } from '@/composables/useReceiptCapture'
import { WORKING, rejectedReason, useReceipts } from '@/composables/useReceipts'
import type { ReceiptRow } from '@/composables/useReceipts'
import { useReconnect } from '@/composables/useReconnect'
import { useTripHistory } from '@/composables/useTripHistory'
import type { HistoryRow } from '@/composables/useTripHistory'
import { useTripRows } from '@/composables/useTripRows'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import { dayOfAnyYear, purchaseDay, timeOfDay } from '@/days'
import { useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { useReceiptQueueStore } from '@/stores/receiptQueue'
import { useTripStore } from '@/stores/trip'

/**
 * «Покупки» (MOL-128) — what was bought, in one list by what asks to be done: the record still
 * being written, the purchases waiting for a verdict, then everything recorded, newest first. The
 * tab that was «Поход»: the record typed by hand is a screen of its own under it now, and with
 * MOL-127 a receipt becomes the second way in.
 *
 * Only the person's own data. Nothing is added up here: the count and the sum of a row are the
 * server's (В-4), and a row read back from the phone says only where and when.
 */
export default defineComponent({
  name: 'PurchasesView',
  components: {
    AppButton,
    AppCard,
    AppReveal,
    AppScreen,
    CaptureButton,
    ManualEntryButton,
    PurchaseRow,
    ReceiptSentLine,
    ReceiptUndoStrip,
    ReceiptWorkSheet,
    ScreenSkeleton,
    ScreenState,
    TripNotices,
    TripUndoStrip,
  },
  setup() {
    const { t, locale } = useI18n()
    const router = useRouter()
    const { goTab } = useNavigation()
    const actor = useActorStore()
    const trips = useTripStore()
    const screen = useTripHistory()
    const { history, rows, loading, trouble } = screen
    const verdicts = useVerdictQueue()
    const pending = computed(() => verdicts.count.value)
    const pendingFrom = usePendingFrom(verdicts)

    const { trip, local, tripId } = useCurrentTrip()
    const { rows: tripRows } = useTripRows(tripId, trip, () => t('trip.queued.unnamed'))
    const open = computed(() => {
      const place = trip.value?.place.name ?? local.value?.placeName
      return tripId.value !== null && place
        ? { place, count: tripRows.value.filter((row) => row.mark !== 'removing').length }
        : null
    })

    /**
     * An empty history is said only when the server said so (`answeredEmpty`, MOL-77) and nothing
     * else is on the screen: purchases waiting for a verdict were made somewhere, and a record open
     * on the phone is a purchase on its way.
     */
    // Receipts (MOL-127): the version «с чеком» for a person whose country the server reads (Р-1).
    const { country } = useReceiptCapture()
    const receipts = useReceipts()
    const receiptQueue = useReceiptQueueStore()
    const receiptRows = computed(() => (country.value ? receipts.rows.value : []))
    const working = computed(() => receiptRows.value.filter((row) => WORKING.includes(row.state)))
    const review = computed(() => receiptRows.value.filter((row) => !WORKING.includes(row.state)))
    const workRow = ref<ReceiptRow | null>(null)
    const workingOpen = ref(false)

    const shown = computed<'list' | 'loading' | 'empty'>(() => {
      if (rows.value.length > 0 || receiptRows.value.length > 0 || trouble.value !== null)
        return 'list'
      if (history.answeredEmpty) return open.value || pending.value > 0 ? 'list' : 'empty'
      return loading.value ? 'loading' : 'list'
    })

    const when = (at: Date) => ({
      day: purchaseDay(at, locale.value),
      time: timeOfDay(at, locale.value),
    })
    const readDay = (row: ReceiptRow): string => {
      const printed = row.summary?.header?.date
      return printed
        ? dayOfAnyYear(new Date(`${printed}T12:00:00Z`), locale.value)
        : when(row.capturedAt).day
    }
    function receiptTitle(row: ReceiptRow): string {
      if (row.state === 'rejected') return t('purchases.rejected_title', when(row.capturedAt))
      const place = row.summary?.place?.name
      if (place && row.state !== 'waiting' && row.state !== 'sending') return place
      if (row.state === 'parsed' || row.state === 'recording' || row.state === 'failed')
        return t('receipt.review.title_no_place', { day: readDay(row) })
      return t('purchases.receipt_from', when(row.capturedAt))
    }
    function receiptMeta(row: ReceiptRow): string {
      const parts = t('receipt.capture.parts', { n: row.parts }, row.parts)
      switch (row.state) {
        case 'waiting':
          return t('purchases.waiting', { parts })
        case 'sending':
          return t('purchases.sending', { parts })
        case 'rejected':
          return t('purchases.rejected_meta', {
            reason: t(
              `purchases.reasons.${rejectedReason(row.rejected?.code ?? 'error.internal')}`,
            ),
          })
        case 'parsing':
          return t('purchases.parsing_unknown')
        case 'failed':
          return t(
            row.summary?.failure === 'reshoot' ? 'purchases.reshoot_meta' : 'purchases.failed_meta',
          )
        case 'recording':
          return t('purchases.recording_meta')
        case 'parsed': {
          const count = row.summary?.lineCount ?? 0
          return t('purchases.recorded', { count: positions(count), day: readDay(row) })
        }
      }
    }
    function receiptNote(row: ReceiptRow): string | null {
      const unsettled = row.summary?.unsettled ?? 0
      return row.state === 'parsed' && unsettled > 0
        ? t('purchases.issues_mismatch', { n: unsettled }, unsettled)
        : null
    }
    function iconOf(row: ReceiptRow) {
      switch (row.state) {
        case 'waiting':
        case 'sending':
          return IconCloudUpload
        case 'parsing':
          return IconSync
        case 'rejected':
        case 'failed':
          return IconFileAlert
        default:
          return IconReceipt
      }
    }
    function openReceipt(row: ReceiptRow): void {
      if (row.state === 'rejected') {
        if (row.rejected) receiptQueue.dismiss(row.rejected)
        return
      }
      if (WORKING.includes(row.state)) {
        workRow.value = row
        workingOpen.value = true
        return
      }
      void router.push({ name: 'purchase-receipt', params: { receiptId: row.id } })
    }

    /**
     * The record going on is the server's to name; asked once per showing, and a failure is the
     * history's to say — the red block's «Повторить» asks for both (adversarial Д).
     */
    /** The record going on is known — remembered, or the server was asked (review Р-18). */
    const asked = ref(trips.current !== null)
    async function loadTrip(): Promise<void> {
      if (!actor.id) return
      try {
        await trips.load()
      } catch {
        // Said by the history's own trouble: one red block, not two.
      } finally {
        asked.value = true
      }
    }
    onMounted(() => void loadTrip())
    watch(
      () => actor.id,
      (id) => {
        if (id) void loadTrip()
      },
    )
    useReconnect(() => void loadTrip())

    const positions = (n: number): string => t('trip.items_count', { n }, n)

    return {
      t,
      asked,
      IconPencil,
      IconStar,
      history,
      rows,
      loading,
      trouble,
      shown,
      open,
      pending,
      pendingFrom,
      positions,
      recordedMeta: (row: HistoryRow): string => {
        const day = dayOfAnyYear(row.at, locale.value)
        if (row.itemCount === null) return day
        const count = positions(row.itemCount)
        return t(row.fromReceipt ? 'purchases.recorded_receipt' : 'purchases.recorded', {
          count,
          day,
        })
      },
      country,
      receipts,
      receiptRows,
      working,
      review,
      workRow,
      working_open: workingOpen,
      receiptTitle,
      receiptMeta,
      receiptNote,
      receiptSum: (row: ReceiptRow): string | null => {
        const total = row.state === 'parsed' ? receipts.total(row) : null
        return total ? formatMoney(total, locale.value) : null
      },
      iconOf,
      openReceipt,
      sum: (row: HistoryRow): string | null =>
        row.total && row.total.length > 0
          ? row.total.map((amount) => formatMoney(amount, locale.value)).join(' · ')
          : null,
      goTab: (tab: 'verdicts') => void goTab(tab),
      goOn: () => void router.push({ name: 'purchase-manual' }),
      openRow: (id: string) => {
        screen.open(id)
      },
      more: () => {
        screen.more()
      },
      retry: () => {
        screen.load()
        void loadTrip()
        void receipts.retry()
      },
    }
  },
})
</script>

<style scoped lang="scss">
.block {
  margin-bottom: var(--space-3);
}

.caption {
  margin: var(--space-6) var(--space-1) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.memory {
  margin: var(--space-4) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.more {
  margin-top: var(--space-4);
}

.strip {
  @include appear;

  padding: var(--space-3) 0;
}

.undo {
  margin-bottom: var(--space-3);
}

.by-hand {
  margin-top: var(--space-1);
}

// A receipt being read «breathes» (handoff 03): no percent, no timer — work that takes a while.
// Still under «reduce motion» and with no connection, when nothing is being read anyway.
.breathing :deep(.icon) {
  animation: breathe 1.6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .breathing :deep(.icon) {
    animation: none;
  }
}

@keyframes breathe {
  50% {
    opacity: 0.35;
  }
}
</style>
