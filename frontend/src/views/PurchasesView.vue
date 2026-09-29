<template>
  <AppScreen :title="t('purchases.title')">
    <TripNotices :ready="asked" />

    <!-- The record going on comes first, without a caption: it is the one thing on this screen
         that is still being done (handoff `03`, Р-4). From the phone as much as from the server —
         a record started with no signal is open all the same. -->
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

    <AppCard v-if="pending > 0" class="block pending" list>
      <PurchaseRow
        :icon="IconStar"
        accent
        :title="t('verdict.pending_count', { n: pending }, pending)"
        :meta="pendingFrom"
        @open="goTab('verdicts')"
      />
    </AppCard>

    <ScreenSkeleton v-if="shown === 'loading'" :groups="[34, 70, 56, 74, 62]" />

    <!-- No circle and no button: the action is in the strip below, and a circle over it read as
         a button of its own (MOL-77). Only for a history known to be empty (`answeredEmpty`). -->
    <ScreenState
      v-else-if="shown === 'empty'"
      kind="empty"
      tone="accent"
      :title="t('purchases.empty.title')"
      :body="t('purchases.empty.body')"
    />

    <ScreenState
      v-if="trouble === 'error'"
      kind="error"
      :inline="rows.length > 0 || !!open"
      :title="t('purchases.error.title')"
      :body="t('purchases.error.body')"
      @retry="retry"
    />
    <ScreenState
      v-else-if="trouble === 'offline'"
      kind="offline"
      tone="warn"
      :inline="rows.length > 0 || !!open"
      :title="t('trip.history.offline_title')"
      :body="t('trip.history.offline_body')"
    />
    <p v-if="history.stale && rows.length > 0" class="memory">{{ t('trip.history.cached') }}</p>

    <template v-if="rows.length > 0">
      <p class="caption">{{ t('purchases.group_recorded') }}</p>
      <AppCard class="recorded" list>
        <PurchaseRow
          v-for="row in rows"
          :key="row.id"
          :title="row.name"
          :meta="recordedMeta(row)"
          :note="row.pending ? t('trip.history.local_finish') : null"
          :sum="sum(row)"
          @open="openRow(row.id)"
        />
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

    <!-- The action under the thumb in every state, loading and failure included: a record goes
         through the queue and needs neither the list nor the network (MOL-77). «Вернуть» of a
         record removed from its own screen stands above it (MOL-76). -->
    <template #docked>
      <div class="strip">
        <TripUndoStrip class="undo" />
        <ManualEntryButton />
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
import { formatMoney } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppScreen from '@/components/AppScreen.vue'
import ManualEntryButton from '@/components/ManualEntryButton.vue'
import PurchaseRow from '@/components/PurchaseRow.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripNotices from '@/components/TripNotices.vue'
import TripUndoStrip from '@/components/TripUndoStrip.vue'
import { useCurrentTrip } from '@/composables/useCurrentTrip'
import { usePendingFrom } from '@/composables/usePendingFrom'
import { useReconnect } from '@/composables/useReconnect'
import { useTripHistory } from '@/composables/useTripHistory'
import type { HistoryRow } from '@/composables/useTripHistory'
import { useTripRows } from '@/composables/useTripRows'
import { useVerdictQueue } from '@/composables/useVerdictQueue'
import { dayOfAnyYear } from '@/days'
import { useNavigation } from '@/navigation'
import { useActorStore } from '@/stores/actor'
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
    AppScreen,
    ManualEntryButton,
    PurchaseRow,
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
    const shown = computed<'list' | 'loading' | 'empty'>(() => {
      if (rows.value.length > 0 || trouble.value !== null) return 'list'
      if (history.answeredEmpty) return open.value || pending.value > 0 ? 'list' : 'empty'
      return loading.value ? 'loading' : 'list'
    })

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
        return row.itemCount === null
          ? day
          : t('purchases.recorded', { count: positions(row.itemCount), day })
      },
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
  padding: var(--space-3) 0;
}

.undo {
  margin-bottom: var(--space-3);
}
</style>
