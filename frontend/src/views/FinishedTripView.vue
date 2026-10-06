<template>
  <AppScreen :title="name || t('trip.history.finished_title')">
    <template #subtitle>{{ meta }}</template>
    <ScreenSkeleton v-if="loading && !available" :groups="[72, 54, 84]" />
    <ScreenState
      v-else-if="missing"
      kind="attention"
      :title="t('trip.history.missing_title')"
      :body="t('trip.history.missing_body')"
    >
      <template #action
        ><AppButton @click="history">{{ t('trip.history.title') }}</AppButton></template
      >
    </ScreenState>
    <template v-else>
      <!-- «Записали N покупок» (5o): once, on arrival from the review of a receipt. -->
      <ScreenState
        v-if="recorded !== null"
        kind="empty"
        tone="good"
        inline
        :icon="IconCheck"
        :title="
          recorded === 0
            ? t('receipt.recorded.sum_title')
            : t('receipt.recorded.title', { n: recorded }, recorded)
        "
        v-bind="recorded === 0 ? {} : { body: t('receipt.recorded.body') }"
      >
        <!-- A sum with no purchase has nothing to rate yet (MOL-227). -->
        <template v-if="recorded !== 0" #action>
          <AppButton variant="ghost" @click="toVerdicts">
            <template #icon><IconStar /></template>
            {{ t('receipt.recorded.to_verdicts') }}
          </AppButton>
        </template>
      </ScreenState>
      <ScreenState
        v-if="trouble === 'error'"
        kind="error"
        :inline="available"
        :title="t('trip.history.error_title')"
        :body="t('trip.history.error_body')"
        @retry="load"
      />
      <ScreenState
        v-else-if="trouble === 'offline'"
        kind="offline"
        tone="warn"
        :inline="available"
        :title="t('trip.history.offline_title')"
        :body="t('trip.history.offline_body')"
      />
      <p v-if="available && stale" class="note">{{ t('trip.history.cached') }}</p>
      <ScreenState
        v-if="rejected"
        kind="attention"
        inline
        :title="t('trip.history.rejected_title')"
        :body="t('trip.history.rejected_body')"
      >
        <template #action
          ><AppButton variant="ghost" @click="review">{{
            t('trip.history.review')
          }}</AppButton></template
        >
      </ScreenState>
      <p v-if="pending" class="note">{{ t('trip.history.pending') }}</p>
      <template v-if="available">
        <TripRateNotes v-if="trip" :trip="trip" />
        <AppCard v-if="rows.length > 0" list
          ><TripRow v-for="row in rows" :key="row.key" :row="row" @open="amend"
        /></AppCard>
        <p v-else class="note">{{ t('trip.history.no_purchases') }}</p>
        <AppButton class="add" variant="ghost" block @click="find">{{
          t('trip.add_item')
        }}</AppButton>
        <!-- The same place as on an open trip: the end of the list (MOL-76, В-1). -->
        <AppButton variant="danger-ghost" block @click="askRemove">{{
          t('trip.remove.action')
        }}</AppButton>
      </template>
    </template>
    <template v-if="available" #docked
      ><TripTotal
        :trip="trip"
        :pending="waiting"
        :local="trip === null"
        :receipt-waiting="receiptWaiting"
        :offer-receipt="offerReceipt"
        :receipt-known="receiptKnown"
        @receipt="receiptOpen = true"
    /></template>
    <ReceiptSheet
      v-if="id"
      v-model:open="receiptOpen"
      :trip-id="id"
      :trip-currency="receiptCurrency"
      :current="receiptCurrent"
      :removable="rows.length > 0"
    />
    <TripRemoveSheet
      v-model:open="removing"
      :place="removal.place"
      :day="removal.day"
      :items="removal.items"
      :steps="2"
      :on-closed="afterRemoveSheet"
      @confirm="confirmRemove"
    />
    <ItemDetailsSheet
      v-if="opened"
      :key="opened.key"
      :entry="opened.entry"
      :expense="opened.expense"
      :retry="opened.retry"
      :trip-id="id"
      :trip-context="trip"
      :trip-currency="local?.currency ?? undefined"
      :close-steps="1"
      :on-closed="close"
    />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import IconCheck from '~icons/mdi/check-circle-outline'
import IconStar from '~icons/mdi/star-outline'
import AppScreen from '@/components/AppScreen.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripRemoveSheet from '@/components/TripRemoveSheet.vue'
import TripRow from '@/components/TripRow.vue'
import TripTotal from '@/components/TripTotal.vue'
import TripRateNotes from '@/components/TripRateNotes.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import ReceiptSheet from '@/components/ReceiptSheet.vue'
import { useFinishedTrip } from '@/composables/useFinishedTrip'
export default defineComponent({
  name: 'FinishedTripView',
  components: {
    AppScreen,
    AppButton,
    AppCard,
    ScreenSkeleton,
    ScreenState,
    TripRemoveSheet,
    TripRow,
    TripTotal,
    TripRateNotes,
    IconStar,
    ItemDetailsSheet,
    ReceiptSheet,
  },
  setup: () => ({ ...useFinishedTrip(), IconCheck }),
})
</script>

<style scoped lang="scss">
.note {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  margin-bottom: var(--space-4);
}

.add {
  margin-top: var(--space-4);
}
</style>
