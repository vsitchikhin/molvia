<template>
  <AppCard v-if="shown.length > 0" as="section" class="market" :aria-labelledby="headingId">
    <SectionCaption :id="headingId" inset>{{ t('exchange.market.title') }}</SectionCaption>

    <!-- One currency at a time (MOL-348, handoff 05, Р-18): the one of the latest exchange first. -->
    <SegmentedControl
      v-if="shown.length > 1"
      :model-value="current.currency"
      :options="currencyOptions"
      :legend="t('exchange.market.currency')"
      hide-legend
      fit
      @update:model-value="chooseCurrency"
    />

    <div v-for="list in lists" :key="list.side" class="list" role="table" :aria-label="list.title">
      <div class="list-head" role="row">
        <span class="list-title" role="columnheader">{{ list.title }}</span>
        <span v-if="current.official" class="list-cb" role="columnheader"
          ><span class="cb-key" aria-hidden="true"></span
          >{{ t('exchange.market.cb', { rate: rateOf(current.official) }) }}</span
        >
      </div>
      <div
        v-for="line in list.lines"
        :key="line.channel"
        class="line"
        :class="{ best: line.best }"
        role="row"
      >
        <span class="channel" role="rowheader"
          >{{ t(SHORT[line.basis]) }} <span class="day">{{ line.day }}</span></span
        >
        <span class="track" aria-hidden="true">
          <span class="rail"></span>
          <TrackSpot v-if="officialAt !== null" :at="officialAt"
            ><span class="cb"></span
          ></TrackSpot>
          <TrackSpot v-if="line.at !== null" :at="line.at"><span class="dot"></span></TrackSpot>
        </span>
        <span class="figure" role="cell"
          ><IconStar v-if="line.best" class="star" aria-hidden="true" />{{ line.rate
          }}<span v-if="line.best" class="spoken">{{ t('exchange.market.best_mark') }}</span></span
        >
      </div>
    </div>

    <p class="legend">
      <IconInfo class="legend-icon" aria-hidden="true" />
      <span>{{ legend }}</span>
    </p>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconInfo from '~icons/mdi/information-outline'
import IconStar from '~icons/mdi/star'
import { currencySign, formatRate, yerevanDate } from '@molvia/model'
import type { Currency, ExchangeRate, MarketToday } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import TrackSpot from '@/components/TrackSpot.vue'
import { calendarDayOfAnyYear } from '@/days'

type Quote = MarketToday['quotes'][number]

/** A channel named short, as «Как меняли» names it (handoff 05) — the words the app already has. */
const SHORT: Readonly<Record<Quote['basis'], string>> = {
  bankCash: 'exchange.sheet.channel_bankCash',
  bankNoncash: 'exchange.market.channel_noncash',
  banksAll: 'exchange.channel.banksAll',
  exchanger: 'exchange.channel.exchanger',
}

/**
 * «Курсы по данным ЦБ РА» (MOL-137, owner's В-1; drawn anew in MOL-348, handoff 05): one currency at a
 * time, where to sell it and where to buy it — the best for the person first, starred and bold, a dot
 * on the one track of the currency, the central bank its dashed line there, and the figure always
 * seen: it is checked against the board at the counter. «Продать» is where the bank buys. The order and
 * the places are the server's (`track`), the best its mark (`bestBuys`, `bestSells`): the phone compares
 * no rates. An answer of a server before them stands the lines as they came, with no dots. Each line
 * carries its own day: the exchange offices reach the central bank a week or two late. No tone: none of
 * it is a difference with the market.
 */
export default defineComponent({
  name: 'MarketRatesCard',
  components: { AppCard, IconInfo, IconStar, SectionCaption, SegmentedControl, TrackSpot },
  props: {
    rows: { type: Array as PropType<MarketToday[]>, required: true },
    /** The currency shown first — the latest exchange's; else the first with figures. */
    first: { type: String as PropType<Currency | null>, default: null },
    /** The screen's day (MOL-329): a line's day says its year when not this one's. */
    today: { type: String, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const shown = computed(() =>
      props.rows.filter((row) => row.official !== null || row.quotes.length > 0),
    )
    const chosen = ref<Currency | null>(null)
    watch(
      () => props.first,
      () => {
        chosen.value = null
      },
    )
    const empty: MarketToday = { currency: 'RUB', official: null, quotes: [] }
    const current = computed(
      () =>
        shown.value.find((row) => row.currency === (chosen.value ?? props.first)) ??
        shown.value[0] ??
        empty,
    )
    const rateOf = (rate: ExchangeRate) => formatRate(rate, locale.value)
    const dayOf = (rate: ExchangeRate) =>
      calendarDayOfAnyYear(yerevanDate(rate.asOf), locale.value, props.today)

    /** A list of one side: the server's order and places, else the lines as they came. */
    function linesOf(side: 'sell' | 'buy') {
      const row = current.value
      const figureOf = (quote: Quote) => (side === 'sell' ? quote.buys : quote.sells)
      const bestOf = (quote: Quote) => (side === 'sell' ? quote.bestBuys : quote.bestSells)
      const order: { channel: Quote['channel']; at: number | null }[] = row.track
        ? row.track[side].map(({ channel, at }) => ({ channel, at }))
        : row.quotes
            .filter((quote) => figureOf(quote))
            .map(({ channel }) => ({ channel, at: null }))
      return order.flatMap(({ channel, at }) => {
        const quote = row.quotes.find((one) => one.channel === channel)
        const figure = quote ? figureOf(quote) : null
        if (!quote || !figure) return []
        return [
          {
            channel,
            basis: quote.basis,
            at,
            best: bestOf(quote),
            rate: rateOf(figure),
            day: dayOf(figure),
          },
        ]
      })
    }
    const lists = computed(() =>
      (['sell', 'buy'] as const)
        .map((side) => ({
          side,
          title: t(`exchange.market.${side}_title`, {
            currency: t(`exchange.market.plural.${current.value.currency}`),
          }),
          lines: linesOf(side),
        }))
        .filter((list) => list.lines.length > 0),
    )
    const officialAt = computed(() => current.value.track?.official ?? null)
    const legend = computed(() => {
      const unit = t('exchange.market.unit', {
        sign: currencySign(current.value.currency, locale.value),
      })
      const starred = current.value.quotes.some((quote) => quote.bestBuys || quote.bestSells)
      if (!starred) return t('exchange.market.legend_no_best', { unit })
      return t(current.value.official ? 'exchange.market.legend' : 'exchange.market.legend_no_cb', {
        unit,
      })
    })
    const currencyOptions = computed(() =>
      shown.value.map((row) => ({
        value: row.currency,
        label: t('exchange.market.tab', {
          sign: currencySign(row.currency, locale.value),
          name: t(`spending.currency_name.${row.currency}`),
        }),
      })),
    )
    return {
      t,
      SHORT,
      headingId: useId(),
      shown,
      current,
      lists,
      officialAt,
      legend,
      currencyOptions,
      rateOf,
      chooseCurrency: (value: string) => {
        chosen.value = shown.value.find((row) => row.currency === value)?.currency ?? null
      },
    }
  },
})
</script>

<style scoped lang="scss">
.market {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.list-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-1) var(--space-3);
}

.list-title {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.list-cb {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.cb-key {
  display: inline-block;
  width: 0;
  height: 0.9em;
  border-left: 2px dashed var(--graphic);
}

/* The name, the track and the figure on one line; narrow, the name stands over the track (MOL-321). */
.line {
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(0, 7.5rem) minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  min-height: 44px;
  font-size: var(--text-callout);
}

@container (max-width: 18rem) {
  .channel {
    grid-column: 1 / -1;
  }
}

.channel {
  overflow-wrap: anywhere;
}

.day {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-regular);
}

.best .channel,
.best .figure {
  font-weight: var(--weight-bold);
}

/* Every mark of the track in one cell. */
.track {
  display: grid;
  align-items: center;
  height: 20px;

  > * {
    grid-area: 1 / 1;
  }
}

.rail {
  height: 2px;
  background: var(--border-strong);
}

.dot {
  flex: none;
  width: 12px;
  height: 12px;
  border: 2px solid var(--graphic);
  border-radius: 50%;
  background: var(--surface);

  .best & {
    width: 16px;
    height: 16px;
    border-color: var(--text);
    background: var(--text);
  }
}

.cb {
  flex: none;
  width: 0;
  height: 20px;
  border-left: 2px dashed var(--graphic);
}

.figure {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

// Nobody presses the star, so it is no terracotta (Ф-4): the best is told by its place, the star,
// the weight and the word read out, never by a colour.
.star {
  @include icon;

  font-size: var(--icon-sm);
  color: var(--text);
}

.spoken {
  @include visually-hidden;
}

.legend {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.legend-icon {
  @include icon;

  font-size: var(--icon-sm);
}
</style>
