<template>
  <AppCard as="section" list class="bars" :aria-labelledby="headingId">
    <h2 :id="headingId" class="caption">{{ t('spending.categories_title') }}</h2>
    <ul class="rows">
      <li v-for="row in rows" :key="row.id">
        <RouterLink
          class="row"
          :to="{ name: 'money-charts', query: { ...period, category: row.id } }"
        >
          <span class="line">
            <span class="dot" :style="{ background: row.colour }" aria-hidden="true"></span>
            <span class="name">{{ row.name }}</span>
            <span class="amount">{{ row.amount }}</span>
          </span>
          <span class="line">
            <span class="track" aria-hidden="true">
              <span class="fill" :style="{ width: row.width, background: row.colour }"></span>
            </span>
            <span class="share">{{ row.share }}</span>
          </span>
        </RouterLink>
      </li>
    </ul>
    <RouterLink class="link" :to="{ name: 'money-charts' }">
      <IconChart class="icon" aria-hidden="true" />
      <span class="label">{{ t('spending.charts_link') }}</span>
      <IconChevron class="chevron" aria-hidden="true" />
    </RouterLink>
    <RouterLink class="link" :to="{ name: 'money-categories' }">
      <IconShape class="icon" aria-hidden="true" />
      <span class="label">{{ t('spending.categories_link') }}</span>
      <IconChevron class="chevron" aria-hidden="true" />
    </RouterLink>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChart from '~icons/mdi/chart-bar'
import IconChevron from '~icons/mdi/chevron-right'
import IconShape from '~icons/mdi/shape-outline'
import { chartMonths, formatEstimate, monthOf, shareOf, yerevanDate } from '@molvia/model'
import type { MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import { categoryColour } from '@/components/spending'

/**
 * «Куда ушли» (MOL-82, handoff 01): a bar per category, largest first — the server's order and its
 * sums; the share is the model's arithmetic over them. Bars rather than a ring: ten names with
 * their sums read as one column. A row opens «Графики» on its category (MOL-74, handoff 01); under
 * them «Графики по месяцам», and last the categories themselves (В-1).
 */
export default defineComponent({
  name: 'CategoryBars',
  components: { AppCard, IconChart, IconChevron, IconShape },
  props: {
    month: { type: Object as PropType<MoneyMonthView>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const headingId = useId()
    /**
     * A month older than the six the charts open on opens them on twelve, so the category tapped is
     * seen in the month it was tapped on (adversarial А); older still, it is drawn as months of nothing.
     */
    const period = computed(() =>
      chartMonths(monthOf(yerevanDate(new Date())), 6).includes(props.month.month)
        ? {}
        : { period: '12' },
    )
    const rows = computed(() =>
      props.month.byCategory.flatMap(({ categoryId, amount }) => {
        const category = props.month.categories.find((one) => one.id === categoryId)
        if (!category) return []
        const share = shareOf(amount, props.month.spent)
        return [
          {
            id: categoryId,
            name: props.nameOf(category),
            colour: categoryColour(category),
            amount: formatEstimate(amount, locale.value),
            // At least 2 %, so that one per cent is still a mark on the track (handoff 01).
            width: `${String(Math.max(share?.percent ?? 0, 2))}%`,
            share: share?.tiny
              ? t('spending.share_tiny')
              : new Intl.NumberFormat(locale.value, { style: 'percent' }).format(
                  (share?.percent ?? 0) / 100,
                ),
          },
        ]
      }),
    )
    return { t, rows, period, headingId }
  },
})
</script>

<style scoped lang="scss">
.caption {
  margin: 0;
  padding: var(--space-3) var(--space-4) var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  gap: var(--space-1);
  min-height: 3.25rem;
  padding: var(--space-2) var(--space-4);
  color: var(--text);
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.line {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.dot {
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: var(--radius-pill);
}

.name {
  flex: 1;
  min-width: 0;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.amount {
  flex: none;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.track {
  flex: 1;
  height: 0.375rem;
  margin-left: var(--space-4);
  overflow: hidden;
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
}

.share {
  flex: none;
  width: 2.25rem;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-4);
  border-top: var(--hairline) solid var(--border);
  color: var(--text);
  font-size: var(--text-body);
  text-decoration: none;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.icon {
  width: 1.375rem;
  height: 1.375rem;
  color: var(--text-muted);
}

.label {
  flex: 1;
}

.chevron {
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}
</style>
