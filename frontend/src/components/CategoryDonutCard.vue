<template>
  <AppCard class="donut">
    <RouterLink class="open" :to="{ name: 'money-charts', query: period }" :aria-label="label">
      <span class="heading">
        <span class="caption">{{ t('spending.categories_title') }}</span>
        <span class="charts-link">
          {{ t('spending.summary.charts') }}<IconChevron class="chevron" aria-hidden="true" />
        </span>
      </span>
      <span class="figure">
        <DonutRing class="ring" :sectors="sectors" :thickness="16" />
        <span class="named">
          <span v-for="row in top" :key="row.key" class="sector">
            <span class="dot" :style="{ background: row.colour }"></span>
            <span class="sector-name">{{ row.name }}</span>
            <span class="sector-share">{{ row.share }}</span>
            <span class="sector-amount">{{ row.amount }}</span>
          </span>
        </span>
      </span>
      <span v-if="hidden > 0" class="rest">
        {{ t('spending.summary.donut_more', { n: hidden }, hidden) }}
      </span>
    </RouterLink>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import { chartMonths, formatEstimate, monthOf, shareOf } from '@molvia/model'
import type { MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import DonutRing from '@/components/DonutRing.vue'
import type { RingSector } from '@/components/DonutRing.vue'
import { categoryColour } from '@/components/spending'
import { localDay } from '@/days'

/** How many sectors are named beside the ring; the rest are counted (handoff MOL-157, 01). */
const NAMED = 3

/**
 * «Куда ушли» on «Деньги» (MOL-156, handoff MOL-157 01): the month's ring and its three largest
 * sectors, the whole card one way into «Графики». The sectors and their levels are the server's
 * (`slices`); the share printed is the model's `shareOf`, as the bars before it printed.
 */
export default defineComponent({
  name: 'CategoryDonutCard',
  components: { AppCard, DonutRing, IconChevron },
  props: {
    month: { type: Object as PropType<MoneyMonthView>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
  },
  setup(props) {
    const { t, locale } = useI18n()
    /**
     * A month older than the six the charts open on opens them on twelve, so the month tapped is
     * among the bars (adversarial А of MOL-74).
     */
    const period = computed(() =>
      chartMonths(monthOf(localDay()), 6).includes(props.month.month) ? {} : { period: '12' },
    )
    const rows = computed(() =>
      props.month.slices.map((slice, index) => {
        const category =
          slice.categoryId === null
            ? undefined
            : props.month.categories.find((one) => one.id === slice.categoryId)
        const share = shareOf(slice.amount, props.month.spent)
        return {
          key: slice.categoryId ?? `rest-${String(index)}`,
          name: category ? props.nameOf(category) : t('spending.charts.rest'),
          colour: category ? categoryColour(category) : 'var(--border-strong)',
          level: slice.level,
          amount: formatEstimate(slice.amount, locale.value),
          share: share?.tiny
            ? t('spending.share_tiny')
            : new Intl.NumberFormat(locale.value, { style: 'percent' }).format(
                (share?.percent ?? 0) / 100,
              ),
        }
      }),
    )
    const sectors = computed<RingSector[]>(() =>
      rows.value.map(({ key, colour, level }) => ({ key, colour, level })),
    )
    const top = computed(() => rows.value.slice(0, NAMED))
    const hidden = computed(() => Math.max(rows.value.length - NAMED, 0))
    const label = computed(() =>
      t('spending.summary.donut_label', {
        list: top.value.map((row) => `${row.name} ${row.share}`).join(', '),
      }),
    )
    return { t, period, sectors, top, hidden, label }
  },
})
</script>

<style scoped lang="scss">
.open {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  color: var(--text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.caption {
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.charts-link {
  display: inline-flex;
  align-items: center;
  color: var(--accent-ink);
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.chevron {
  width: 1.25rem;
  height: 1.25rem;
}

.figure {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.ring {
  flex: none;
  width: 6.75rem;
  height: 6.75rem;
}

.named {
  display: grid;
  flex: 1;
  gap: var(--space-2);
  min-width: 0;
}

.sector {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  column-gap: var(--space-2);
  align-items: center;
}

.dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

.sector-name {
  overflow: hidden;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sector-share {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.sector-amount {
  grid-column: 2 / 4;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.rest {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
