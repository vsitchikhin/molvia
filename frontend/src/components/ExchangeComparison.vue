<template>
  <div class="comparison">
    <span v-if="exchange.rate" class="line">
      <span class="label">{{ t('exchange.card_rate') }}</span>
      <span class="value own">{{ rateOf(exchange.rate) }}</span>
    </span>
    <!-- The market first — what one could have got at a counter that day — and the central bank under
         it, quieter: nobody changes at its rate (MOL-137, Р-5). Against the market the difference is
         «хуже / лучше» and takes its tone (Ф-30); against the bank it is a difference and nothing more,
         no tone (Д-5). -->
    <template v-if="market">
      <template v-for="line in marketLines" :key="line.label">
        <span class="line">
          <span class="label">{{ line.label }}</span>
          <span class="value">{{ line.rate }}</span>
        </span>
        <span class="difference" :class="line.tone">{{ line.difference }}</span>
      </template>
      <span v-if="market.pending" class="missing">{{ market.pending }}</span>
    </template>
    <span :class="{ quiet: market }" class="official">
      <template v-if="official">
        <span class="line">
          <span class="label">{{ official.label }}</span>
          <span class="value">{{ official.rate }}</span>
        </span>
        <span class="difference">{{ official.difference }}</span>
      </template>
      <!-- Under a market comparison «nothing to compare with» would be untrue (review). -->
      <span v-else class="missing">{{
        market && !exchange.officialDoubtful
          ? t('exchange.card_no_official_short', { bank: bankOf(exchange) })
          : noOfficialOf(exchange)
      }}</span>
    </span>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ExchangeView } from '@molvia/model'
import { useExchangeWords } from '@/composables/useExchangeWords'

/**
 * An exchange beside the market of its day and the central bank (MOL-137, MOL-187), on a plate in the
 * sheet of its amendment (MOL-348): the list's row says only the difference with the market, and this
 * is where the rate, the best of the day, the own channel and the bank stand — every exchange is still
 * set beside the central bank of its own day (MOL-40), a step quieter and with no tone.
 */
export default defineComponent({
  name: 'ExchangeComparison',
  props: {
    exchange: { type: Object as PropType<ExchangeView>, required: true },
  },
  setup(props) {
    const { t } = useI18n()
    const words = useExchangeWords()
    const market = computed(() => words.marketOf(props.exchange))
    return {
      t,
      ...words,
      official: computed(() => words.officialOf(props.exchange)),
      market,
      marketLines: computed(() =>
        market.value ? [market.value.best, ...(market.value.own ? [market.value.own] : [])] : [],
      ),
    }
  },
})
</script>

<style scoped lang="scss">
.comparison {
  /* The figure goes under its words where the two cannot stand side by side (MOL-321). */
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
  font-size: var(--text-footnote);
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  column-gap: var(--space-3);

  > :first-child {
    flex: 1 1 min-content;
  }
}

.label,
.missing {
  color: var(--text-muted);
}

.value {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.own {
  font-weight: var(--weight-bold);
}

// The official comparison under the market's: the same lines, a step quieter.
.official {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.quiet {
  padding-top: var(--space-2);
  border-top: var(--hairline) solid var(--border);
  color: var(--text-muted);

  .difference {
    font-weight: var(--weight-regular);
  }
}

.difference {
  font-weight: var(--weight-medium);

  &.bad {
    color: var(--bad-ink);
  }

  &.good {
    color: var(--good-ink);
  }
}
</style>
