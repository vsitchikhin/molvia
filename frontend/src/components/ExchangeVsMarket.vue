<template>
  <AppCard as="section" class="vs-market" :aria-labelledby="headingId">
    <SectionCaption :id="headingId" inset>{{ t('exchange.vs_market.title') }}</SectionCaption>

    <template v-if="losses">
      <div class="head">
        <p class="total" :class="toneOf(losses.total)" :style="figureChars(totalText)">
          {{ totalText }}
        </p>
        <p class="word" :class="toneOf(losses.total)">{{ totalWord }}</p>
        <p class="note">{{ countLine }}</p>
      </div>

      <p class="legend" aria-hidden="true">
        <span class="key"
          ><span class="swatch up"></span>{{ t('exchange.vs_market.legend_up') }}</span
        >
        <span class="key"
          ><span class="swatch line"></span>{{ t('exchange.vs_market.legend_line') }}</span
        >
        <span v-if="hasWorse" class="key"
          ><span class="swatch down"></span>{{ t('exchange.vs_market.legend_down') }}</span
        >
      </p>

      <!-- A bar an exchange from the line «как по рынку дня» (MOL-348, handoff 02): up — more drams
           than the market of its day gave, down — less, each height the server's. A bar is a button
           that chooses its exchange: the plate under it and the same exchange on the line below. -->
      <div class="plot">
        <button
          v-for="bar in bars"
          :key="bar.id"
          type="button"
          class="cell"
          :class="[kindOf(bar), { chosen: bar.id === chosenId }]"
          :aria-pressed="bar.id === chosenId"
          :aria-label="labelOf(bar)"
          @click="choose(bar.id)"
        >
          <span class="half up" :style="{ height: `${upShare}%` }">
            <template v-if="bar.level > 0 || bar.sign !== -1">
              <span v-if="labelled(bar)" class="value" aria-hidden="true">{{ valueOf(bar) }}</span>
              <span class="bar" :style="barStyle(bar)"></span>
            </template>
          </span>
          <span class="half down">
            <template v-if="bar.level < 0 || bar.sign === -1">
              <span class="bar" :style="barStyle(bar)"></span>
              <span v-if="labelled(bar)" class="value" aria-hidden="true">{{ valueOf(bar) }}</span>
            </template>
          </span>
        </button>
      </div>
      <p class="months" aria-hidden="true">
        <span
          v-for="bar in bars"
          :key="bar.id"
          class="month"
          :class="{ chosen: bar.id === chosenId }"
          >{{ monthLabelled(bar) ? monthOf(bar.exchangedOn) : '' }}</span
        >
      </p>

      <div v-if="chosenBar" class="plate" aria-live="polite">
        <p class="plate-where">{{ whereOf(chosenBar) }}</p>
        <p class="plate-diff" :class="kindOf(chosenBar)">{{ diffOf(chosenBar) }}</p>
        <p class="plate-amounts">{{ amountsOf(chosenBar) }}</p>
        <p class="plate-word" :class="kindOf(chosenBar)">{{ wordOf(chosenBar) }}</p>
      </div>

      <p v-if="losses.uncounted > 0" class="note">
        {{ t('exchange.vs_market.uncounted', { n: losses.uncounted }, losses.uncounted) }}
      </p>

      <div v-if="losses.groups.length > 1" class="places">
        <p class="places-title">{{ t('exchange.vs_market.places') }}</p>
        <ul class="place-list">
          <li v-for="group in losses.groups" :key="group.place ?? ''" class="place">
            <span class="place-name"
              >{{ group.place ?? t('exchange.vs_market.no_place') }}
              <span class="place-count">{{
                t('exchange.vs_market.place_count', { n: group.count })
              }}</span></span
            >
            <span class="place-figures">
              <span class="place-amount" :class="toneOf(group.difference)">{{
                amountOf(group.difference)
              }}</span>
              <span class="place-percent" :class="toneOf(group.difference)">{{
                signedPercent(group.percent, locale, true)
              }}</span>
            </span>
            <span class="track" aria-hidden="true"
              ><span
                class="fill"
                :class="toneOf(group.difference)"
                :style="{ width: widthOf(group.level) }"
              ></span
            ></span>
            <span class="unseen">{{ wordOfMoney(group.difference) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Incomes alone and no exchange (handoff 3k): the quiet note, nothing drawn. -->
    <p v-else class="quiet">
      <span class="quiet-circle" aria-hidden="true"><IconSwap /></span>
      <span>{{ t('exchange.vs_market.incomes_only') }}</span>
    </p>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHART_LEVEL, decimalFromMinor, formatMoney } from '@molvia/model'
import type { ExchangeLossesView, ExchangeView, ExchangesResponse, Money } from '@molvia/model'
import IconSwap from '~icons/mdi/swap-horizontal'
import AppCard from '@/components/AppCard.vue'
import { signedAmount } from '@/components/accounts'
import { signedPercent } from '@/components/charts'
import { figureChars } from '@/components/figure'
import { roundsToNought } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'
import { calendarDay, calendarDayOfAnyYear } from '@/days'

type Bar = NonNullable<ExchangesResponse['bars']>[number]

/** Values over the bars only while each has room for one (handoff 02). */
const LABELLED_AT_MOST = 6
/** Months under the bars only while they do not run into each other. */
const MONTHS_AT_MOST = 8
/** From ten thousand a value over a bar is «+18,8 тыс». */
const COMPACT_FROM = 10_000
/** The least a bar off the line is drawn, so a small difference is still seen. */
const LEAST_PX = 3

/**
 * «Обмены против рынка» drawn (MOL-348, handoff 02; MOL-152 in MOL-159 before): the total of twelve
 * months, a bar an exchange from the line «как по рынку дня», the plate of the exchange chosen and the
 * places as bars. Every figure, height and sign is the server's (`losses`, `bars`); the phone counts the
 * bars by their sign for the line under the total, and names the months. The tone is only the
 * difference with the market's, never alone: the bar's direction, the sign and the word stand beside it
 * (Ф-30). One sign a row, the money's (MOL-190); an amount whole unless that prints a nought for money
 * that is there (adversarial А1 of MOL-187).
 */
export default defineComponent({
  name: 'ExchangeVsMarket',
  components: { AppCard, IconSwap, SectionCaption },
  props: {
    losses: { type: Object as PropType<ExchangeLossesView | null>, default: null },
    bars: { type: Array as PropType<readonly Bar[]>, default: () => [] },
    exchanges: { type: Array as PropType<readonly ExchangeView[]>, default: () => [] },
    /** The exchange chosen here or on the line of the rate; null — the default. */
    chosen: { type: String as PropType<string | null>, default: null },
    today: { type: String, required: true },
  },
  emits: {
    'update:chosen': (id: string) => typeof id === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()

    const toneOf = (money: Money) => (money.minor < 0n ? 'bad' : money.minor > 0n ? 'good' : null)
    const kindOf = (bar: Bar) =>
      bar.sign === null ? 'none' : bar.sign < 0 ? 'bad' : bar.sign > 0 ? 'good' : 'even'
    const amountOf = (money: Money) =>
      signedAmount(money, locale.value, { plus: true, estimate: !roundsToNought(money) })
    const wordOfMoney = (money: Money) =>
      money.minor === 0n
        ? t('exchange.vs_market.even')
        : t(money.minor < 0n ? 'exchange.vs_market.worse' : 'exchange.vs_market.better')

    const totalText = computed(() => (props.losses ? amountOf(props.losses.total) : ''))
    const totalWord = computed(() => {
      const total = props.losses?.total
      if (!total) return ''
      return t(
        total.minor > 0n
          ? 'exchange.vs_market.word_better'
          : total.minor < 0n
            ? 'exchange.vs_market.word_worse'
            : 'exchange.vs_market.even',
      )
    })
    const countLine = computed(() => {
      const signs = props.bars.map((bar) => bar.sign)
      const better = signs.filter((sign) => sign === 1).length
      const worse = signs.filter((sign) => sign === -1).length
      const even = signs.filter((sign) => sign === 0).length
      const measured = better + worse + even
      if (measured === 1 && better === 1) return t('exchange.vs_market.count_one')
      if (measured > 0 && better === measured)
        return t('exchange.vs_market.count_all', { n: measured })
      return [
        better > 0 ? t('exchange.vs_market.count_better', { n: better }) : null,
        worse > 0 ? t('exchange.vs_market.count_worse', { n: worse }) : null,
        even > 0 ? t('exchange.vs_market.count_even', { n: even }) : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ')
    })

    const furthestUp = computed(() => Math.max(0, ...props.bars.map(({ level }) => level)))
    const furthestDown = computed(() => Math.max(0, ...props.bars.map(({ level }) => -level)))
    const hasWorse = computed(() => props.bars.some(({ sign }) => sign === -1))
    /** Where the line stands, from the top: all the height for bars up, a share for bars down. */
    const upShare = computed(() => {
      const span = furthestUp.value + furthestDown.value
      return span === 0 ? 100 : Math.max(35, (furthestUp.value * 100) / span)
    })
    /** A bar's height in its half: the furthest of that half takes four fifths, room left for its value. */
    function barStyle(bar: Bar): Record<string, string> {
      // «Без сравнения» is a dashed frame of its own size on the line, no height of the money.
      if (bar.sign === null) return {}
      const furthest = bar.level < 0 ? furthestDown.value : furthestUp.value
      const share = furthest === 0 ? 0 : (Math.abs(bar.level) * 80) / furthest
      return { height: `max(${String(LEAST_PX)}px, ${String(share)}%)` }
    }

    const chosenId = computed(() => {
      if (props.chosen && props.bars.some(({ id }) => id === props.chosen)) return props.chosen
      const measured = props.bars.filter(({ sign }) => sign !== null)
      return (measured.at(-1) ?? props.bars.at(-1))?.id ?? null
    })
    const chosenBar = computed(() => props.bars.find(({ id }) => id === chosenId.value) ?? null)
    const choose = (id: string) => {
      emit('update:chosen', id)
    }

    const widest = computed(() =>
      props.bars.reduce<Bar | null>(
        (most, bar) => (most === null || Math.abs(bar.level) > Math.abs(most.level) ? bar : most),
        null,
      ),
    )
    const labelled = (bar: Bar) =>
      props.bars.length <= LABELLED_AT_MOST ||
      bar.id === chosenId.value ||
      bar.id === widest.value?.id
    const monthLabelled = (bar: Bar) => {
      if (props.bars.length <= MONTHS_AT_MOST) return true
      return (
        bar.id === props.bars[0]?.id ||
        bar.id === props.bars.at(-1)?.id ||
        bar.id === chosenId.value
      )
    }
    function valueOf(bar: Bar): string {
      if (bar.difference === null) return '?'
      const whole = Number(decimalFromMinor(bar.difference))
      if (Math.abs(whole) < COMPACT_FROM) return amountOf(bar.difference)
      // A label of the chart, not an amount: «+18,8 тыс» over a bar (handoff 02), the amount whole in
      // the plate and in the bar's name.
      const compact = new Intl.NumberFormat(locale.value, {
        notation: 'compact',
        maximumFractionDigits: 1,
        signDisplay: 'exceptZero',
      }).format(whole)
      return compact.replace('-', '−')
    }
    const monthOf = (day: string) =>
      calendarDay(day, locale.value, { month: 'short' }).replace('.', '')

    const exchangeOf = (bar: Bar) => props.exchanges.find(({ id }) => id === bar.id) ?? null
    const dayOf = (bar: Bar) => calendarDayOfAnyYear(bar.exchangedOn, locale.value, props.today)
    const whereOf = (bar: Bar) => `${dayOf(bar)} · ${bar.place ?? t('exchange.vs_market.no_place')}`
    function amountsOf(bar: Bar): string {
      const exchange = exchangeOf(bar)
      if (!exchange) return ''
      return t('exchange.row_amounts', {
        given: formatMoney(exchange.given, locale.value),
        received: formatMoney(exchange.received, locale.value),
      })
    }
    const diffOf = (bar: Bar) => (bar.difference ? amountOf(bar.difference) : '')
    function wordOf(bar: Bar): string {
      if (bar.sign === null) return t('exchange.vs_market.none_said')
      const word =
        bar.sign === 0
          ? t('exchange.vs_market.even')
          : t(bar.sign < 0 ? 'exchange.vs_market.worse' : 'exchange.vs_market.better')
      return bar.percent === null || bar.sign === 0
        ? word
        : `${signedPercent(bar.percent, locale.value, true)} · ${word}`
    }
    const labelOf = (bar: Bar) =>
      [whereOf(bar), diffOf(bar), wordOf(bar)].filter((part) => part !== '').join(': ')

    const widthOf = (level: number) => `${String((Math.abs(level) * 100) / CHART_LEVEL)}%`

    return {
      t,
      locale,
      headingId: useId(),
      figureChars,
      signedPercent,
      toneOf,
      kindOf,
      amountOf,
      wordOfMoney,
      totalText,
      totalWord,
      countLine,
      hasWorse,
      upShare,
      barStyle,
      chosenId,
      chosenBar,
      choose,
      labelled,
      monthLabelled,
      valueOf,
      monthOf,
      whereOf,
      amountsOf,
      diffOf,
      wordOf,
      labelOf,
      widthOf,
    }
  },
})
</script>

<style scoped lang="scss">
.vs-market {
  display: grid;
  gap: var(--space-4);
}

.head {
  /* The figure measures itself against the card's head (`figure-fit`, MOL-321). */
  container-type: inline-size;
  display: grid;
  gap: var(--space-1);
}

.total {
  @include display-type;
  @include figure-fit;

  margin: 0;
  font-variant-numeric: tabular-nums;
}

.word {
  margin: 0;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;
}

.good {
  color: var(--good-ink);
}

.bad {
  color: var(--bad-ink);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
}

.key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: var(--radius-mark);

  &.up {
    background: var(--good);
  }

  &.down {
    background: var(--bad);
  }

  &.line {
    height: 2px;
    background: var(--graphic);
  }
}

.plot {
  display: flex;
  flex-direction: row;
  height: 8rem;
}

.cell {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
}

.half {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;

  &.up {
    justify-content: flex-end;
    border-bottom: 2px solid var(--graphic);
  }

  &.down {
    flex: 1 1 0;
    justify-content: flex-start;
  }
}

.bar {
  flex: none;
  width: min(30px, 70%);
}

.good .bar {
  border-radius: var(--radius-mark) var(--radius-mark) 0 0;
  background: var(--good);
}

.bad .bar {
  border-radius: 0 0 var(--radius-mark) var(--radius-mark);
  background: var(--bad);
}

.even .bar {
  width: 6px;
  background: var(--graphic);
}

.none .bar {
  width: 14px;
  height: 14px;
  border: 1.5px dashed var(--graphic);
  border-radius: var(--radius-mark);
}

.chosen .bar {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.value {
  padding: var(--space-1) 0;
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  .good & {
    color: var(--good-ink);
  }

  .bad & {
    color: var(--bad-ink);
  }

  .even &,
  .none & {
    color: var(--text-muted);
  }
}

.months {
  display: flex;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
}

.month {
  flex: 1 1 0;
  min-width: 0;
  text-align: center;

  &.chosen {
    color: var(--text);
    font-weight: var(--weight-bold);
  }
}

.plate {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--surface-2);

  p {
    margin: 0;
  }
}

.plate-where {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  overflow-wrap: anywhere;
}

.plate-diff {
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.plate-amounts {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.plate-word {
  font-size: var(--text-footnote);
  text-align: right;

  &.none,
  &.even {
    color: var(--text);
  }
}

.places {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: var(--hairline) solid var(--border);
}

.places-title {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.place-list {
  display: grid;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.place {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  justify-content: space-between;
}

.place-name {
  flex: 1 1 min-content;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.place-count {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-regular);
}

.place-figures {
  display: flex;
  gap: var(--space-1);
  align-items: baseline;
  margin-left: auto;
  white-space: nowrap;
}

.place-amount {
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
}

.place-percent {
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.track {
  display: block;
  flex-basis: 100%;
  height: 6px;
  border-radius: var(--radius-mark);
  background: var(--surface-2);
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-mark);
  background: var(--graphic);

  &.good {
    background: var(--good);
  }

  &.bad {
    background: var(--bad);
  }
}

.quiet {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.quiet-circle {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface-2);

  svg {
    @include icon;

    font-size: var(--icon-md);
  }
}

.unseen {
  @include visually-hidden;
}
</style>
