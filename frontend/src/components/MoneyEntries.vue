<template>
  <nav :aria-label="t('spending.entries_label')">
    <AppCard list>
      <RouterLink class="entry" :to="{ name: 'exchange' }">
        <IconSwap class="entry-icon" aria-hidden="true" />
        <span class="entry-label">{{ t('exchange.title') }}</span>
        <span v-if="shown" class="entry-value">{{ shown }}</span>
        <IconChevron class="entry-chevron" aria-hidden="true" />
      </RouterLink>
      <RouterLink class="entry" :to="{ name: 'incomes' }">
        <IconCashPlus class="entry-icon" aria-hidden="true" />
        <span class="entry-label">{{ t('income.title') }}</span>
        <IconChevron class="entry-chevron" aria-hidden="true" />
      </RouterLink>
    </AppCard>
  </nav>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCashPlus from '~icons/mdi/cash-plus'
import IconChevron from '~icons/mdi/chevron-right'
import IconSwap from '~icons/mdi/swap-horizontal'
import { formatRate } from '@molvia/model'
import type { ExchangeRate } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'

/**
 * The way into «Обмен денег» and «Доходы» from «Деньги» (MOL-81, handoff 01): they moved here
 * from «Настройки». Not a tile beside «Пришло»: the tiles are the month's, and an exchange and a
 * rate are not. Beside the exchanges, the person's own rate — the one looked for there; the
 * central bank's is not it, so without one of their own the row says nothing (handoff, question 2).
 */
export default defineComponent({
  name: 'MoneyEntries',
  components: { AppCard, IconCashPlus, IconChevron, IconSwap },
  props: {
    rate: { type: Object as PropType<ExchangeRate | null>, default: null },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const shown = computed(() =>
      props.rate?.source === 'personal' ? formatRate(props.rate, locale.value) : null,
    )
    return { t, shown }
  },
})
</script>

<style scoped lang="scss">
.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-3) 0 var(--space-4);
  color: inherit;
  text-decoration: none;

  &:hover {
    background: var(--surface-2);
  }

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.entry-icon {
  flex: none;
  width: var(--space-6);
  height: var(--space-6);
  color: var(--text-muted);
}

.entry-label {
  flex: 1;
  min-width: 0;
}

.entry-value {
  color: var(--text-muted);
  font-size: var(--text-callout);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.entry-chevron {
  flex: none;
  width: var(--space-6);
  height: var(--space-6);
  color: var(--text-muted);
}
</style>
