<template>
  <nav :aria-label="t('spending.entries_label')">
    <AppCard list>
      <RouterLink
        v-for="row in rows"
        :key="row.key"
        class="entry"
        :to="row.to"
        :aria-label="row.value ? t('spending.entry_value', row) : undefined"
      >
        <component :is="row.icon" class="entry-icon" aria-hidden="true" />
        <span class="entry-label">{{ row.name }}</span>
        <span v-if="row.value" class="entry-value" aria-hidden="true">{{ row.value }}</span>
        <IconChevron class="entry-chevron" aria-hidden="true" />
      </RouterLink>
    </AppCard>
  </nav>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw } from 'vue'
import type { Component, PropType } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useI18n } from 'vue-i18n'
import IconBank from '~icons/mdi/bank-outline'
import IconCashPlus from '~icons/mdi/cash-plus'
import IconChevron from '~icons/mdi/chevron-right'
import IconList from '~icons/mdi/format-list-bulleted'
import IconShape from '~icons/mdi/shape-outline'
import IconSwap from '~icons/mdi/swap-horizontal'
import AppCard from '@/components/AppCard.vue'

/** The one figure of each row, or null until it is known — the row is a way in either way. */
export interface EntryValues {
  readonly spendings: string | null
  readonly accounts: string | null
  /** The person's own rate; the central bank's is not «my rate», so none says nothing (MOL-81). */
  readonly rate: string | null
  readonly incomes: string | null
  readonly categories: string | null
}

const NONE: EntryValues = {
  spendings: null,
  accounts: null,
  rate: null,
  incomes: null,
  categories: null,
}

/**
 * The ways out of «Деньги» (MOL-159, handoff MOL-157 01): «Траты» of the month shown, then what is
 * «now» and not the month's — «Счета», «Обмен денег», «Доходы», «Категории» — each with one figure,
 * all of them from answers the screen already has. A newcomer has no «Траты»: nothing to see there.
 */
export default defineComponent({
  name: 'MoneyEntries',
  components: { AppCard, IconChevron },
  props: {
    /** The month «Траты» open on, the one on screen; null — the running one. */
    month: { type: String as PropType<string | null>, default: null },
    values: { type: Object as PropType<EntryValues>, default: () => NONE },
    spendings: { type: Boolean, default: true },
  },
  setup(props) {
    const { t } = useI18n()
    const rows = computed(() => {
      const all: {
        key: string
        name: string
        value: string | null
        icon: Component
        to: RouteLocationRaw
      }[] = [
        {
          key: 'spendings',
          name: t('spending.list.title'),
          value: props.values.spendings,
          icon: markRaw(IconList),
          to: {
            name: 'money-spendings',
            query: props.month ? { month: props.month } : {},
          },
        },
        {
          key: 'accounts',
          name: t('accounts.title'),
          value: props.values.accounts,
          icon: markRaw(IconBank),
          to: { name: 'money-accounts' },
        },
        {
          key: 'exchange',
          name: t('exchange.title'),
          value: props.values.rate,
          icon: markRaw(IconSwap),
          to: { name: 'exchange' },
        },
        {
          key: 'incomes',
          name: t('income.title'),
          value: props.values.incomes,
          icon: markRaw(IconCashPlus),
          to: { name: 'incomes' },
        },
        {
          key: 'categories',
          name: t('spending.categories_link'),
          value: props.values.categories,
          icon: markRaw(IconShape),
          to: { name: 'money-categories' },
        },
      ]
      return props.spendings ? all : all.filter((row) => row.key !== 'spendings')
    })
    return { t, rows }
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
