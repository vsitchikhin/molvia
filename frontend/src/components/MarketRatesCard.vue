<template>
  <AppCard v-if="shown.length > 0" class="market">
    <SectionCaption inset>{{ t('exchange.market.title') }}</SectionCaption>
    <p class="hint">{{ t('exchange.market.hint') }}</p>
    <table v-for="row in shown" :key="row.currency" class="table">
      <caption class="currency">
        <span class="name">{{ t(`spending.currency_name.${row.currency}`) }}</span>
        <span v-if="row.official" class="official">
          {{
            t('exchange.market.official', {
              date: dayOfRate(row.official),
              rate: rateOf(row.official),
            })
          }}
        </span>
      </caption>
      <thead>
        <tr>
          <th scope="col">
            <span class="spoken">{{ t('exchange.market.where') }}</span>
          </th>
          <th scope="col" class="figure">{{ t('exchange.market.sell') }}</th>
          <th scope="col" class="figure">{{ t('exchange.market.buy') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="quote in row.quotes" :key="quote.channel">
          <th scope="row" class="channel">
            {{ t(`exchange.channel.${quote.basis}`) }}
            <span class="date">{{ dateOf(quote) }}</span>
          </th>
          <td class="figure" :class="{ best: quote.bestBuys }">
            <template v-if="quote.buys">
              <IconStar v-if="quote.bestBuys" class="star" aria-hidden="true" />{{
                rateOf(quote.buys)
              }}<span v-if="quote.bestBuys" class="spoken"
                >, {{ t('exchange.market.best_mark') }}</span
              >
            </template>
          </td>
          <td class="figure" :class="{ best: quote.bestSells }">
            <template v-if="quote.sells">
              <IconStar v-if="quote.bestSells" class="star" aria-hidden="true" />{{
                rateOf(quote.sells)
              }}<span v-if="quote.bestSells" class="spoken"
                >, {{ t('exchange.market.best_mark') }}</span
              >
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconStar from '~icons/mdi/star'
import { formatRate, yerevanDate } from '@molvia/model'
import type { ExchangeRate, MarketToday } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { calendarDay } from '@/days'

/**
 * «Курсы по данным ЦБ РА» (MOL-137, owner's decision В-1): what banks and exchange offices gave
 * people for each currency on their latest published day, beside the official rate. «Продать» is
 * where the bank buys — the person's side is named, not the bank's. Each row carries its own day:
 * the exchange offices reach the central bank a week or two late. Which figure is the best is the
 * server's to say; the star is never the only sign — the word is read out with it.
 */
export default defineComponent({
  name: 'MarketRatesCard',
  components: { AppCard, IconStar, SectionCaption },
  props: {
    rows: { type: Array as PropType<MarketToday[]>, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const dayOfRate = (rate: ExchangeRate): string =>
      calendarDay(yerevanDate(rate.asOf), locale.value, { day: 'numeric', month: 'short' })
    return {
      t,
      shown: computed(() =>
        props.rows.filter((row) => row.official !== null || row.quotes.length > 0),
      ),
      rateOf: (rate: ExchangeRate) => formatRate(rate, locale.value),
      dayOfRate,
      dateOf: (quote: MarketToday['quotes'][number]): string => {
        const rate = quote.buys ?? quote.sells
        return rate ? t('exchange.market.row_date', { date: dayOfRate(rate) }) : ''
      },
    }
  },
})
</script>

<style scoped lang="scss">
.market {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-footnote);
}

.currency {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
  padding-bottom: var(--space-1);
  text-align: left;
}

.name {
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
}

.official {
  color: var(--text-muted);
}

th,
td {
  padding: var(--space-1) 0;
  border-top: var(--hairline) solid var(--border);
  vertical-align: baseline;
}

thead th {
  border-top: 0;
  color: var(--text-muted);
  font-weight: var(--weight-medium);
}

.channel {
  font-weight: var(--weight-regular);
  text-align: left;
}

.date {
  display: block;
  color: var(--text-muted);
}

.figure {
  padding-left: var(--space-2);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.best {
  font-weight: var(--weight-bold);
}

.star {
  @include icon;

  font-size: var(--icon-sm);
  margin-right: var(--space-1);
  color: var(--accent-ink);
  vertical-align: -0.1em;
}

.spoken {
  @include visually-hidden;
}
</style>
