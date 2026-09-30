<template>
  <AppCard class="donut">
    <RouterLink
      class="open"
      :to="{ name: 'money-charts', query }"
      :aria-label="top.length > 0 ? label : undefined"
    >
      <span class="heading">
        <span class="caption">{{ t('spending.categories_title') }}</span>
        <span class="charts-link">
          {{ t('spending.summary.charts') }}<IconChevron class="chevron" aria-hidden="true" />
        </span>
      </span>
      <span v-if="top.length > 0" class="figure">
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
      <span v-else-if="waiting === 'read'" class="why">{{
        t('spending.summary.donut_later')
      }}</span>
      <span v-else-if="waiting === 'rate'" class="why">
        {{ t('spending.summary.donut_uncounted') }}
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
 * sectors, the whole card one way into «Графики» — an empty month's too, with no ring: «В этом месяце
 * трат нет» is said once, by the journal under it, until MOL-159 takes the journal to «Траты». A
 * month spent in with no ring says why in the ring's place. The sectors and their levels are the
 * server's (`slices`) — the phone adds nothing up, not even for a month kept before the ring; the
 * share printed is the model's `shareOf`, as the bars before it printed.
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
    /**
     * Every sector of the ring. One of a category the month does not name stays on the ring, so it
     * closes, but in `--border` and with no name: called «Остальные», it passed for a second one
     * (review 7). Never happens while the month names every category, archived ones too.
     */
    const all = computed(() =>
      props.month.slices.map((slice) => {
        const category =
          slice.categoryId === null
            ? null
            : props.month.categories.find((one) => one.id === slice.categoryId)
        const share = shareOf(slice.amount, props.month.spent)
        return {
          key: slice.categoryId ?? 'rest',
          id: category?.id ?? null,
          named: category !== undefined,
          name: category ? props.nameOf(category) : t('spending.charts.rest'),
          colour:
            category === undefined
              ? 'var(--border)'
              : category
                ? categoryColour(category)
                : 'var(--border-strong)',
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
    const rows = computed(() => all.value.filter((row) => row.named))
    const sectors = computed<RingSector[]>(() =>
      all.value.map(({ key, colour, level }) => ({ key, colour, level })),
    )
    const top = computed(() => rows.value.slice(0, NAMED))
    /** Sectors past the three that the ring draws: one of no level is on no ring (adversarial Б). */
    const hidden = computed(() => rows.value.slice(NAMED).filter((row) => row.level > 0).length)
    /**
     * The charts open on the largest category of the ring, the one seen first (review 3, owner's
     * choice «а»): opened on the period's largest, the card named «Кафе» and «Графики» showed rent.
     * The first sector always names one — «Остальные» are only ever last (`donutSlices`).
     */
    const query = computed(() => {
      const first = rows.value[0]?.id
      return first ? { ...period.value, category: first } : period.value
    })
    const label = computed(() =>
      t('spending.summary.donut_label', {
        list: top.value.map((row) => `${row.name} ${row.share}`).join(', '),
      }),
    )
    /**
     * No ring, and yet the month was spent in: said in the ring's place, never left a caption over
     * nothing (adversarial round 2, Е, Ж). Categories and no sectors — a month kept before the ring,
     * or an answer of a server older than it — waits for the next read; nothing a rate counted —
     * everything in a currency with no rate — waits for a rate. An empty month says nothing here.
     */
    const waiting = computed<'read' | 'rate' | null>(() => {
      if (props.month.slices.length > 0) return null
      if (props.month.byCategory.length > 0) return 'read'
      return props.month.uncounted.length > 0 ? 'rate' : null
    })
    return { t, query, sectors, top, hidden, label, waiting }
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

.rest,
.why {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
