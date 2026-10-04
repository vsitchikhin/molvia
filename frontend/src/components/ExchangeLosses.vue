<template>
  <AppCard as="section" list class="losses" :aria-labelledby="headingId">
    <div class="head">
      <SectionCaption :id="headingId" inset>{{ t('exchange.vs_market.title') }}</SectionCaption>
      <p class="total" :class="{ negative: losses.total.minor < 0n }">
        {{ signedAmount(losses.total, locale, { plus: true, estimate: true }) }}
      </p>
      <p class="note">{{ t('exchange.vs_market.note') }}</p>
      <p v-if="losses.uncounted > 0" class="note">
        {{ t('exchange.vs_market.uncounted', { n: losses.uncounted }, losses.uncounted) }}
      </p>
    </div>
    <ul class="rows">
      <li v-for="group in losses.groups" :key="group.place ?? ''" class="row">
        <span class="place">{{ group.place ?? t('exchange.vs_market.no_place') }}</span>
        <span class="percent" :class="toneOf(group.percent)">
          {{ signedPercent(group.percent, locale, true) }}
        </span>
        <span class="meta">{{
          t('exchange.vs_market.count', { n: group.count }, group.count)
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
  </AppCard>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHART_LEVEL } from '@molvia/model'
import type { ExchangeLossesView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import { signedAmount } from '@/components/accounts'
import { signedPercent } from '@/components/charts'
import SectionCaption from '@/components/SectionCaption.vue'

/**
 * «Обмены против рынка» (MOL-74, owner's decision В-1; on «Обмен денег» and against the market since
 * MOL-152 in MOL-159): the exchanges of twelve months by exchanger, worst first — each with its
 * count, its percent weighed by the money and its difference in the spending currency, all the
 * server's. The total has no «≈ ₽» (review Р-7 of MOL-157): past differences at today's rate would
 * creep with the rate. Here «плохо / хорошо» is the meaning of the row, so the colours are the
 * verdict's, the minus red (Р-2); a bar grows from the centre line, minus to the left. The rows are
 * not buttons.
 */
export default defineComponent({
  name: 'ExchangeLosses',
  components: { AppCard, SectionCaption },
  props: {
    losses: {
      type: Object as PropType<ExchangeLossesView>,
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

.total {
  @include display-type;

  margin: 0;
  font-size: var(--text-figure);
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
  border-radius: var(--radius-mark);

  &.bad {
    background: var(--bad);
  }

  &.good {
    background: var(--good);
  }
}
</style>
