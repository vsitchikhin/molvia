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
      </template>
    </template>
    <template v-if="available" #docked
      ><TripTotal :trip="trip" :pending="waiting" :local="trip === null"
    /></template>
    <ItemDetailsSheet
      v-if="opened"
      :key="opened.key"
      :entry="opened.entry"
      :expense="opened.expense"
      :retry="opened.retry"
      :trip-id="id"
      :trip-context="trip"
      :trip-currency="local?.currency"
      :close-steps="1"
      :on-closed="close"
    />
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import AppScreen from '@/components/AppScreen.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripRow from '@/components/TripRow.vue'
import TripTotal from '@/components/TripTotal.vue'
import TripRateNotes from '@/components/TripRateNotes.vue'
import ItemDetailsSheet from '@/components/ItemDetailsSheet.vue'
import { useFinishedTrip } from '@/composables/useFinishedTrip'
export default defineComponent({
  name: 'FinishedTripView',
  components: {
    AppScreen,
    AppButton,
    AppCard,
    ScreenSkeleton,
    ScreenState,
    TripRow,
    TripTotal,
    TripRateNotes,
    ItemDetailsSheet,
  },
  setup: useFinishedTrip,
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
