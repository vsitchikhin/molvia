<template>
  <AppCard as="section" list class="losses" :aria-labelledby="headingId">
    <div class="head">
      <h2 :id="headingId" class="caption">{{ t('spending.charts.fx_title') }}</h2>
      <p class="total" :class="{ negative: losses.total.minor < 0n }">
        {{ signedAmount(losses.total, locale, { plus: true, estimate: true }) }}
      </p>
      <p class="note">{{ t('spending.charts.fx_note') }}</p>
      <p v-if="losses.uncounted > 0" class="note">
        {{ t('spending.charts.fx_uncounted', { n: losses.uncounted }, losses.uncounted) }}
      </p>
    </div>
    <ul class="rows">
      <li v-for="group in losses.groups" :key="group.place ?? ''" class="row">
        <span class="place">{{ group.place ?? t('spending.charts.fx_no_place') }}</span>
        <span class="percent" :class="toneOf(group.percent)">
          {{ signedPercent(group.percent, locale, true) }}
        </span>
        <span class="meta">{{
          t('spending.charts.fx_count', { n: group.count }, group.count)
        }}</span>
        <span class="amount">
          {{ signedAmount(group.difference, locale, { plus: true, estimate: true }) }}
        </span>
        <span class="bar" aria-hidden="true">
          <span class="half before">
            <span
              v-if="group.level < 0"
              class="fill bad"
              :style="{ width: widthOf(group.level) }"
            ></span>
          </span>
          <span class="half after">
            <span
              v-if="group.level > 0"
              class="fill good"
              :style="{ width: widthOf(group.level) }"
            ></span>
          </span>
        </span>
      </li>
    </ul>
    <RouterLink class="link" :to="{ name: 'exchange' }">
      <IconSwap class="icon" aria-hidden="true" />
      <span class="label">{{ t('exchange.title') }}</span>
      <IconChevron class="chevron" aria-hidden="true" />
    </RouterLink>
  </AppCard>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevron from '~icons/mdi/chevron-right'
import IconSwap from '~icons/mdi/swap-horizontal'
import { CHART_LEVEL } from '@molvia/model'
import type { MoneyChartsView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import { signedAmount } from '@/components/accounts'
import { signedPercent } from '@/components/charts'

/**
 * «Обмены против курса ЦБ РА» (MOL-74, owner's decision В-1): the exchanges of twelve months by
 * exchanger, worst first — each with its count, its percent weighed by the money and its difference
 * in the spending currency, all the server's. Here «плохо / хорошо» is the meaning of the row, so
 * the colours are the verdict's; a bar grows from the centre line, minus to the left.
 */
export default defineComponent({
  name: 'ExchangeLosses',
  components: { AppCard, IconChevron, IconSwap },
  props: {
    losses: {
      type: Object as PropType<NonNullable<MoneyChartsView['exchanges']>>,
      required: true,
    },
  },
  setup() {
    const { t, locale } = useI18n()
    const toneOf = (percent: number) => (percent < 0 ? 'bad' : percent > 0 ? 'good' : null)
    const widthOf = (level: number) => `${String((Math.abs(level) * 100) / CHART_LEVEL)}%`
    return { t, locale, headingId: useId(), toneOf, widthOf, signedAmount, signedPercent }
  },
})
</script>

<style scoped lang="scss">
.head {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4) var(--space-4) var(--space-1);
}

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.total {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 800;
  font-variant-numeric: tabular-nums;

  &.negative {
    color: var(--bad-ink);
  }
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5rem;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-top: var(--hairline) solid var(--border);
}

.place {
  overflow: hidden;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.percent {
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  text-align: right;

  &.bad {
    color: var(--bad-ink);
  }

  &.good {
    color: var(--good-ink);
  }
}

.meta,
.amount {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.amount {
  text-align: right;
}

.bar {
  display: flex;
  grid-column: 1 / -1;
  height: 6px;
  margin-top: var(--space-1);
}

.half {
  display: flex;
  flex: 1;
}

.before {
  justify-content: flex-end;
  border-right: 2px solid var(--border-strong);
}

.fill {
  height: 100%;
  border-radius: 3px;

  &.bad {
    background: var(--bad);
  }

  &.good {
    background: var(--good);
  }
}

.link {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target-lg);
  padding: 0 var(--space-4);
  border-top: var(--hairline) solid var(--border);
  color: var(--text);
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
  font-size: var(--text-body);
}

.chevron {
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}
</style>
