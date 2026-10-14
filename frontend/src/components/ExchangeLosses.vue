<template>
  <AppCard as="section" list class="losses" :aria-labelledby="headingId">
    <div class="head">
      <SectionCaption :id="headingId" inset>{{ t('exchange.vs_market.title') }}</SectionCaption>
      <p class="total" :class="toneOf(losses.total)">
        {{ amountOf(losses.total) }}
      </p>
      <p v-if="toneOf(losses.total)" class="word" :class="toneOf(losses.total)">
        {{ wordOf(losses.total) }}
      </p>
      <p class="note">{{ t('exchange.vs_market.note') }}</p>
      <p v-if="losses.uncounted > 0" class="note">
        {{ t('exchange.vs_market.uncounted', { n: losses.uncounted }, losses.uncounted) }}
      </p>
    </div>
    <ul class="rows">
      <li v-for="group in losses.groups" :key="group.place ?? ''" class="row">
        <span class="place">{{ group.place ?? t('exchange.vs_market.no_place') }}</span>
        <span class="percent" :class="toneOf(group.difference)">
          {{ signedPercent(group.percent, locale, true) }}
        </span>
        <span class="meta">{{ metaOf(group) }}</span>
        <span class="amount" :class="toneOf(group.difference)">
          {{ amountOf(group.difference) }}
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
import type { ExchangeLossesView, Money } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import { signedAmount } from '@/components/accounts'
import { signedPercent } from '@/components/charts'
import { roundsToNought } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'

/**
 * «Обмены против рынка» (MOL-74, owner's decision В-1; on «Обмен денег» and against the market since
 * MOL-152 in MOL-159): the exchanges of twelve months by exchanger, worst first — each with its
 * count, its percent weighed by the money and its difference in the spending currency, all the
 * server's. The total has no «≈ ₽» (review Р-7 of MOL-157): past differences at today's rate would
 * creep with the rate. Here «плохо / хорошо» is the meaning of the row, so the total, the percent
 * and the amount take the tone both ways, and the words «хуже / лучше рынка» stand beside them — a
 * colour never alone (Ф-30, В-11). One sign a row: the money's — the percent, rounded to
 * hundredths, may read 0,00 % over a difference that is not nothing (Р-4); nothing is no tone and
 * no word. The amounts are whole units unless that prints a nought for money that is there: «−0,30 ֏
 * · хуже рынка», as the card of the exchange prints it, never «−0 ֏» under a verdict (adversarial
 * А1). A bar grows from the centre line, minus to the left. The rows are not buttons.
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
    const toneOf = (money: Money) => (money.minor < 0n ? 'bad' : money.minor > 0n ? 'good' : null)
    const wordOf = (money: Money): string | null =>
      money.minor === 0n
        ? null
        : t(money.minor < 0n ? 'exchange.vs_market.worse' : 'exchange.vs_market.better')
    function metaOf(group: ExchangeLossesView['groups'][number]): string {
      const count = t('exchange.vs_market.count', { n: group.count }, group.count)
      const word = wordOf(group.difference)
      return word ? t('exchange.vs_market.count_word', { count, word }) : count
    }
    const amountOf = (money: Money) =>
      signedAmount(money, locale.value, { plus: true, estimate: !roundsToNought(money) })
    const widthOf = (level: number) => `${String((Math.abs(level) * 100) / CHART_LEVEL)}%`
    return {
      t,
      locale,
      headingId: useId(),
      toneOf,
      wordOf,
      metaOf,
      amountOf,
      widthOf,
      signedPercent,
    }
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
}

.word {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.bad {
  color: var(--bad-ink);
}

.good {
  color: var(--good-ink);
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
}

.meta,
.amount {
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.meta {
  color: var(--text-muted);
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
  border-right: 2px solid var(--graphic);
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
