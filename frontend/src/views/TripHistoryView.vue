<template>
  <AppScreen :title="t('trip.history.title')">
    <ScreenSkeleton v-if="loading && rows.length === 0" :groups="[72, 54, 84]" />
    <ScreenState
      v-else-if="rows.length === 0 && trouble === null"
      kind="empty"
      tone="accent"
      :icon="IconHistory"
      :title="t('trip.history.empty_title')"
      :body="t('trip.history.empty_body')"
    >
      <template #action
        ><AppButton block @click="home">{{ t('trip.history.go_trip') }}</AppButton></template
      >
    </ScreenState>
    <ScreenState
      v-if="trouble === 'error'"
      kind="error"
      :inline="rows.length > 0"
      :title="t('trip.history.error_title')"
      :body="t('trip.history.error_body')"
      @retry="load"
    />
    <ScreenState
      v-else-if="trouble === 'offline'"
      kind="offline"
      tone="warn"
      :inline="rows.length > 0"
      :title="t('trip.history.offline_title')"
      :body="t('trip.history.offline_body')"
    />
    <p v-if="history.stale && rows.length > 0" class="memory">{{ t('trip.history.cached') }}</p>
    <AppCard v-if="rows.length > 0" list>
      <TripHistoryRow v-for="row in rows" :key="row.id" :row="row" @open="open" />
    </AppCard>
    <AppButton
      v-if="history.page.nextCursor && trouble !== 'offline'"
      class="more"
      variant="ghost"
      :disabled="loading"
      @click="more"
      >{{ t('trip.history.more') }}</AppButton
    >
  </AppScreen>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import IconHistory from '~icons/mdi/history'
import AppScreen from '@/components/AppScreen.vue'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import TripHistoryRow from '@/components/TripHistoryRow.vue'
import { useTripHistory } from '@/composables/useTripHistory'
export default defineComponent({
  name: 'TripHistoryView',
  components: { AppScreen, AppButton, AppCard, ScreenSkeleton, ScreenState, TripHistoryRow },
  setup: () => ({ ...useTripHistory(), IconHistory }),
})
</script>

<style scoped lang="scss">
.memory {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.more,
.memory {
  margin-top: var(--space-4);
}
</style>
