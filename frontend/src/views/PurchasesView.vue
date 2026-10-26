<template>
  <AppScreen :title="t('purchases.title')">
    <!-- The connection is one line under the header, over everything the answer drew (Ф-14, MOL-181):
         the history and the receipts are one list of purchases, so one strip says both — never three
         ways of «from memory» on one screen. Only over something of an answer: with nothing shown it
         is the state below. -->
    <StatusStrip
      v-if="strip"
      class="connection"
      :kind="strip.kind"
      :text="strip.text"
      :attempt="strip.attempt"
    >
      <template #action>
        <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
      </template>
    </StatusStrip>
    <TripNotices :ready="asked" />

    <!-- The record going on comes first, without a caption: it is the one thing on this screen
         that is still being done (handoff `03`, Р-4). From the phone as much as from the server —
         a record started with no signal is open all the same. -->
    <AppReveal>
      <!-- «Продолжить» is the row's one control, a button of the kit in its tail (В-1 «а»): a button in
           a button is no HTML. Its name carries the place, so a screen reader hears what goes on. -->
      <AppCard v-if="open" class="block open" list>
        <ListRow
          as="div"
          :icon="IconPencil"
          :title="open.place"
          :meta="t('purchases.open_manual_meta', { count: positions(open.count) })"
          wrap
        >
          <template #tail>
            <AppButton
              variant="secondary"
              :label="t('purchases.manual_ask.continue', { place: open.place })"
              @click="goOn"
              >{{ t('purchases.continue') }}</AppButton
            >
          </template>
        </ListRow>
      </AppCard>
    </AppReveal>

    <AppReveal>
      <!-- The star is a status, not a button: muted, the chevron says it opens (Ф-4). -->
      <AppCard v-if="pending > 0 && !country" class="block pending" list>
        <ListRow
          :icon="IconStar"
          :title="t('verdict.pending_count', { n: pending }, pending)"
          :meta="pendingFrom ?? ''"
          wrap
          next
          @click="goTab('verdicts')"
        />
      </AppCard>
    </AppReveal>

    <!-- Receipts (MOL-127, handoff 03): in work, then to look at and record — each section only
         when it has a row. -->
    <template v-if="working.length > 0">
      <SectionCaption as="p" class="caption">{{ t('purchases.group_working') }}</SectionCaption>
      <AppCard class="block" list>
        <AppReveal group>
          <ListRow
            v-for="row in working"
            :key="row.id"
            :icon="iconOf(row)"
            :class="{ breathing: row.state === 'parsing' && receipts.online.value }"
            :tone="row.state === 'rejected' || row.state === 'stuck' ? 'warn' : ''"
            :title="receiptTitle(row)"
            :meta="receiptMeta(row)"
            wrap
            next
            @click="openReceipt(row)"
          />
        </AppReveal>
      </AppCard>
    </template>
    <template v-if="review.length > 0">
      <SectionCaption as="p" class="caption">{{ t('purchases.group_review') }}</SectionCaption>
      <AppCard class="block" list>
        <AppReveal group>
          <ListRow
            v-for="row in review"
            :key="row.id"
            :icon="iconOf(row)"
            :tone="row.state === 'failed' ? 'warn' : ''"
            :title="receiptTitle(row)"
            :meta="receiptMeta(row)"
            wrap
            next
            @click="openReceipt(row)"
          >
            <!-- Under the meta, not in it: cut with it at two lines it would be lost (Р-5). -->
            <template v-if="receiptNote(row)" #below>
              <span class="note">{{ receiptNote(row) }}</span>
            </template>
            <template v-if="receiptSum(row)" #tail>{{ receiptSum(row) }}</template>
          </ListRow>
        </AppReveal>
      </AppCard>
    </template>

    <AppReveal>
      <AppCard v-if="pending > 0 && country" class="block pending" list>
        <ListRow
          :icon="IconStar"
          :title="t('verdict.pending_count', { n: pending }, pending)"
          :meta="pendingFrom ?? ''"
          wrap
          next
          @click="goTab('verdicts')"
        />
      </AppCard>
    </AppReveal>

    <!-- The answer's shape (Ф-13, Р-7): «Записаны» and three rows with a sum and a chevron, no icon —
         a recorded row has none. The record going on is no part of it: drawn from the phone, it stands
         over the skeleton already, and a bar in its place would go from under a person with none. -->
    <ScreenSkeleton v-if="shown === 'loading'" class="loading">
      <SkeletonPart kind="caption" :width="22" />
      <SkeletonPart kind="rows" tail next />
    </ScreenSkeleton>

    <!-- No button: the action is in the strip below. The circle is the quiet one, which does not
         read as a button (Ф-16, MOL-77). Only for a history known to be empty (`answeredEmpty`). -->
    <ScreenState
      v-else-if="shown === 'empty'"
      kind="empty"
      :icon="IconCart"
      :title="t('purchases.empty.title')"
      :body="t(country ? 'purchases.empty_capture.body' : 'purchases.empty.body')"
    />

    <!-- Always a section's error: the strip records a purchase with the server down, through the
         queue, and stays the screen's (Ф-15, 124 3l; MOL-180, В-1). -->
    <ScreenState
      v-if="state === 'error'"
      kind="error"
      inline
      :title="t('purchases.error.title')"
      :body="t(country ? 'purchases.error_capture' : 'purchases.error.body')"
      @retry="retry"
    />
    <!-- Nothing of an answer to show: the screen's own words, never «what is on the phone» over
         nothing (Ф-19). -->
    <ScreenState
      v-else-if="state === 'offline'"
      kind="offline"
      tone="warn"
      :inline="!!open || pending > 0"
      :title="t('purchases.offline.title')"
      :body="t(country ? 'purchases.offline_capture' : 'purchases.offline.body')"
    />

    <template v-if="rows.length > 0">
      <SectionCaption as="p" class="caption">{{ t('purchases.group_recorded') }}</SectionCaption>
      <AppCard class="recorded" list>
        <AppReveal group>
          <ListRow
            v-for="row in rows"
            :key="row.id"
            :title="row.name"
            :meta="recordedMeta(row)"
            wrap
            next
            @click="openRow(row.id)"
          >
            <template v-if="row.pending" #below>
              <span class="note">{{ t('trip.history.local_finish') }}</span>
            </template>
            <template v-if="sum(row)" #tail>{{ sum(row) }}</template>
          </ListRow>
        </AppReveal>
      </AppCard>
      <AppButton
        v-if="history.page.nextCursor && trouble !== 'offline'"
        class="more"
        variant="ghost"
        :busy="loadingMore"
        :busy-label="t('trip.history.loading')"
        :disabled="loading && !loadingMore"
        @click="more"
        >{{ t('trip.history.more') }}</AppButton
      >
      <!-- With no connection the list is not whole, and says where it stops (MOL-128, П.5). -->
      <p v-else-if="history.page.nextCursor" class="earlier">
        {{ t('purchases.earlier_online', { day: earlierDay }) }}
      </p>
    </template>

    <ReceiptWorkSheet
      v-model:open="working_open"
      :row="workRow"
      :title="workRow ? receiptTitle(workRow) : ''"
      :meta="workRow ? receiptMeta(workRow) : null"
    />

    <!-- «Вернуть» of a record removed from its own screen (MOL-76), and of a receipt, in the one
         place over the strip (Ф-29); each strip draws itself only while its removal can be taken back. -->
    <template v-if="removing" #undo>
      <TripUndoStrip />
      <ReceiptUndoStrip v-if="capture" />
    </template>

    <!-- The action under the thumb in every state, loading and failure included: a record goes
         through the queue and needs neither the list nor the network (MOL-77). -->
    <template #docked>
      <template v-if="capture">
        <ReceiptSentLine />
        <CaptureButton :country="capture" />
        <ManualEntryButton by-hand />
      </template>
      <ManualEntryButton v-else />
    </template>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import IconCart from '~icons/mdi/cart-outline'
import IconPencil from '~icons/mdi/pencil-outline'
import IconStar from '~icons/mdi/star-outline'
import IconCloudUpload from '~icons/mdi/cloud-upload-outline'
import IconFileAlert from '~icons/mdi/file-alert-outline'
import IconReceipt from '~icons/mdi/receipt-text-outline'
import IconSync from '~icons/mdi/sync'
import { formatMoney, withoutItems } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppReveal from '@/components/AppReveal.vue'
import AppScreen from '@/components/AppScreen.vue'
import CaptureButton from '@/components/CaptureButton.vue'
import ListRow from '@/components/ListRow.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import ReceiptSentLine from '@/components/ReceiptSentLine.vue'
import ReceiptUndoStrip from '@/components/ReceiptUndoStrip.vue'
import ReceiptWorkSheet from '@/components/ReceiptWorkSheet.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import type { StripKind } from '@/components/StatusStrip.vue'
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
import { calendarDay, dateOfAnyYear, dayOfAnyYear, purchaseDay, timeOfDay } from '@/days'
import { useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
import { useReceiptQueueStore } from '@/stores/receiptQueue'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'

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
    ListRow,
    ManualEntryButton,
    ReceiptSentLine,
    ReceiptUndoStrip,
    ReceiptWorkSheet,
    ScreenSkeleton,
    ScreenState,
    SectionCaption,
    SkeletonPart,
    StatusStrip,
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
    const { history, rows, loading, loadingMore, trouble, failures } = screen
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
    // Receipts (MOL-127): the version «с чеком» — the camera — for a person whose country the server
    // reads (Р-1); the receipts a person holds are shown whatever the country, since one taken before a
    // move to Georgia or Serbia is still to be recorded or removed (MOL-109, adversarial А2).
    const { country } = useReceiptCapture()
    // the strip's receipt: the camera, a Serbian receipt's QR read off the photo (MOL-233) included
    const capture = country
    // The place of «Вернуть» only while a removal waits: each strip still decides whether its ten
    // seconds are left (Р-7).
    const tripQueue = useTripQueueStore()
    const receiptQueue = useReceiptQueueStore()
    const removing = computed(() =>
      Boolean(tripQueue.lastRemoved ?? (capture.value ? receiptQueue.lastRemoved : null)),
    )
    const receipts = useReceipts()
    const receiptRows = computed(() => receipts.rows.value)
    const working = computed(() => receiptRows.value.filter((row) => WORKING.includes(row.state)))
    const review = computed(() => receiptRows.value.filter((row) => !WORKING.includes(row.state)))
    // The sheet follows the live row: a receipt read while it is up says so (review 21).
    const workId = ref<string | null>(null)
    const workKept = ref<ReceiptRow | null>(null)
    const workRow = computed(
      () => receiptRows.value.find((row) => row.id === workId.value) ?? workKept.value,
    )
    const workingOpen = ref(false)

    /**
     * «Пусто» only for what is known to be empty (MOL-77): the history answered empty, and — for a
     * person who takes receipts — the list of receipts too (review 7): a receipt taken on another phone
     * is a purchase on its way.
     */
    const shown = computed<'list' | 'loading' | 'empty'>(() => {
      if (rows.value.length > 0 || receiptRows.value.length > 0 || trouble.value !== null)
        return 'list'
      // Asked of everyone since MOL-109 (А2), so known empty only once answered, for everyone (Б1).
      const receiptsKnown = receipts.knownEmpty.value
      if (history.answeredEmpty) {
        if (open.value || pending.value > 0) return 'list'
        if (receiptsKnown) return 'empty'
        return receipts.trouble.value ? 'list' : 'loading'
      }
      return loading.value ? 'loading' : 'list'
    })

    /** The worse of the two reads behind the screen — the history's and the receipts'. */
    const connection = computed<'offline' | 'error' | null>(() => {
      const both = [trouble.value, receipts.trouble.value]
      if (both.includes('offline')) return 'offline'
      return both.includes('error') ? 'error' : null
    })
    /** Something of an answer is drawn: the rows the phone kept of «Записаны» or of the receipts. */
    const fromMemory = computed(() => rows.value.length > 0 || receiptRows.value.length > 0)
    /**
     * The one strip (Р-2, Р-6 of MOL-204): over what is shown from memory, as old as the older of the
     * reads that failed and drew something — nothing on screen is newer than that; a read that failed
     * with nothing of it on screen dates nothing, unless no other did. A read whose moment the phone
     * does not know — a cache from before the moment was kept — names no time at all.
     */
    const strip = computed<{ kind: StripKind; text: string; attempt: number } | null>(() => {
      const kind = connection.value
      if (kind === null || !fromMemory.value) return null
      const failed = [
        ...(trouble.value === null ? [] : [{ at: history.answeredAt, drawn: rows.value.length }]),
        ...(receipts.trouble.value === null
          ? []
          : [{ at: receipts.fetchedAt.value, drawn: receiptRows.value.length }]),
      ]
      const drawn = failed.filter((read) => read.drawn > 0)
      const moments = (drawn.length > 0 ? drawn : failed).map((read) => read.at)
      const known = moments.filter((at): at is Date => at !== null)
      const at =
        known.length === moments.length && known.length > 0
          ? known.reduce((older, one) => (one < older ? one : older))
          : null
      const key = kind === 'offline' ? 'purchases.stale' : 'purchases.stale_error'
      return {
        kind: kind === 'offline' ? 'offline' : 'unanswered',
        text: at ? t(key, when(at)) : t(`${key}_untimed`),
        attempt: failures.value + receipts.attempt.value,
      }
    })
    /** With nothing of an answer to show, the state says it instead of the strip. */
    const state = computed(() => (fromMemory.value ? null : connection.value))

    const when = (at: Date) => ({
      day: purchaseDay(at, locale.value),
      time: timeOfDay(at, locale.value),
    })
    // A printed day is a calendar day, never a moment (review 23).
    const readDay = (row: ReceiptRow): string => {
      const printed = row.summary?.header?.date
      return printed
        ? calendarDay(printed, locale.value, { day: 'numeric', month: 'short' })
        : when(row.capturedAt).day
    }
    function receiptTitle(row: ReceiptRow): string {
      // a receipt by its link has no photo to name (MOL-232)
      if (row.state === 'rejected' && row.parts > 0)
        return t('purchases.rejected_title', when(row.capturedAt))
      const place = row.summary?.place?.name
      if (place && row.state !== 'waiting' && row.state !== 'sending') return place
      if (row.state === 'parsed' || row.state === 'recording' || row.state === 'failed')
        return t('receipt.review.title_no_place', { day: readDay(row) })
      return t('purchases.receipt_from', when(row.capturedAt))
    }
    function receiptMeta(row: ReceiptRow): string {
      // a receipt by its link has no parts: it is a link (MOL-232)
      const byLink = row.parts === 0
      const parts = byLink
        ? t('purchases.by_link')
        : t('receipt.capture.parts', { n: row.parts }, row.parts)
      switch (row.state) {
        case 'waiting':
          return t('purchases.waiting', { parts })
        case 'sending':
          return t('purchases.sending', { parts })
        case 'stuck':
          return t('purchases.stuck_meta', { parts })
        case 'rejected':
          return t('purchases.rejected_meta', {
            reason: t(
              `purchases.reasons.${rejectedReason(row.rejected?.code ?? 'error.internal')}`,
            ),
          })
        case 'parsing':
          return t(byLink ? 'purchases.asking_tax_office' : 'purchases.parsing_unknown')
        case 'failed': {
          const failure = row.summary?.failure
          if (failure === 'missing' || failure === 'invalid') return t(`purchases.${failure}_meta`)
          return t(failure === 'reshoot' ? 'purchases.reshoot_meta' : 'purchases.failed_meta')
        }
        case 'recording':
          return t('purchases.recording_meta')
        case 'parsed': {
          const count = row.summary?.lineCount ?? 0
          // a sole trader's section with no items: a sum to record (MOL-227)
          if (withoutItems({ status: 'parsed', lineCount: count }))
            return t('purchases.no_items_meta', { day: readDay(row) })
          return t('purchases.recorded', { count: positions(count), day: readDay(row) })
        }
      }
    }
    function receiptNote(row: ReceiptRow): string | null {
      if (row.recordRefused && row.state === 'parsed') return t('purchases.record_refused')
      // a line with no figures read is not settled either (MOL-255): one word true of both
      const unsettled = row.summary?.unsettled ?? 0
      return row.state === 'parsed' && unsettled > 0
        ? t('purchases.issues_check', { n: unsettled }, unsettled)
        : null
    }
    function iconOf(row: ReceiptRow) {
      switch (row.state) {
        case 'waiting':
        case 'sending':
        case 'stuck':
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
      // «Не принят» and every receipt in work open their sheet: a tap removes nothing (review 8).
      if (WORKING.includes(row.state)) {
        workId.value = row.id
        workKept.value = row
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
      IconCart,
      removing,
      t,
      asked,
      IconPencil,
      IconStar,
      history,
      rows,
      loading,
      loadingMore,
      trouble,
      shown,
      strip,
      state,
      earlierDay: computed(() => {
        const last = rows.value.at(-1)
        return last ? dateOfAnyYear(last.at, locale.value) : ''
      }),
      open,
      pending,
      pendingFrom,
      positions,
      recordedMeta: (row: HistoryRow): string => {
        const day = dayOfAnyYear(row.at, locale.value)
        if (row.itemCount === null) return day
        // a trip with its sum and no purchase — from a receipt with no items or typed by hand (MOL-78) —
        // is the sum, never «0 позиций»; «по чеку» says «из чека» already (MOL-227, Р-6, review 1 № 2)
        if (row.itemCount === 0 && (row.total?.length ?? 0) > 0)
          return t('purchases.recorded_sum', { day })
        const count = positions(row.itemCount)
        return t(row.fromReceipt ? 'purchases.recorded_receipt' : 'purchases.recorded', {
          count,
          day,
        })
      },
      country,
      capture,
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

// 8 to what it dates, as the handoff's 3k draws it.
.connection {
  margin-bottom: var(--space-2);
}

// Where «Записаны» of the answer stands: its caption has 24 above it, the frame's first part none.
.loading {
  margin-top: var(--space-6);
}

.caption {
  margin-top: var(--space-6);
}

.earlier {
  margin: var(--space-2) 0 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  text-align: center;
}

.more {
  margin-top: var(--space-2);
}

.note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

// A receipt being read «breathes» (handoff 03): no percent, no timer — work that takes a while.
// Still with no connection, when nothing is being read anyway.
.breathing :deep(.icon) {
  @include work-breath;
}
</style>
