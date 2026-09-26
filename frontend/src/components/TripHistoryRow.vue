<template>
  <button class="history-row" type="button" @click="$emit('open', row.id)">
    <span class="text">
      <span class="place">{{ row.name }}</span>
      <span class="when">{{ t('trip.history.finished_at', { when }) }}</span>
      <span v-if="row.pending" class="pending">{{ t('trip.history.local_finish') }}</span>
    </span>
    <IconChevronRight class="chevron" aria-hidden="true" />
  </button>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevronRight from '~icons/mdi/chevron-right'
import type { HistoryRow } from '@/composables/useTripHistory'
import { purchaseDay, timeOfDay } from '@/days'

/**
 * One finished trip: where, when it was finished, and whether the phone is still holding the
 * finish back. On two screens — the history and the home screen without a trip (MOL-77) — so it
 * is one component, and the day is said the way every other day in the app is: «вчера, 19:40».
 */
export default defineComponent({
  name: 'TripHistoryRow',
  components: { IconChevronRight },
  props: {
    row: { type: Object as PropType<HistoryRow>, required: true },
  },
  emits: { open: (id: string) => typeof id === 'string' },
  setup(props) {
    const { t, locale } = useI18n()
    const when = computed(() =>
      t('trip.history.when', {
        day: purchaseDay(props.row.at, locale.value),
        time: timeOfDay(props.row.at, locale.value),
      }),
    )
    return { t, when }
  },
})
</script>

<style scoped lang="scss">
.history-row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: calc(var(--touch-target-lg) + var(--space-3));
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  border: 0;
  color: var(--text);
  background: var(--surface);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.text {
  flex: 1;
  min-width: 0;
}

.place {
  display: block;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);

  // A shop's full name has no spaces to break at — the same reason `TripRow` wraps its own.
  overflow-wrap: anywhere;
}

.when,
.pending {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.pending {
  margin-top: var(--space-1);
  color: var(--warn-ink);
}

.chevron {
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}
</style>
