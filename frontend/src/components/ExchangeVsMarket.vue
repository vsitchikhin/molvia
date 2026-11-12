<template>
  <AppCard as="section" class="vs-market" :aria-labelledby="headingId">
    <SectionCaption :id="headingId" inset>{{ t('exchange.vs_market.title') }}</SectionCaption>

    <!-- The bars stand whenever there are exchanges of the twelve months, measured or not: all of
         them «без сравнения» — a pair without the dram, the dinar, a day with no market — is no
         «Обменов пока нет» over a list of them (review №1, adversarial А1). -->
    <template v-if="losses || bars.length > 0">
      <div v-if="losses" class="head">
        <p class="total" :class="toneOf(losses.total)" :style="figureChars(totalText)">
          {{ totalText }}
        </p>
        <p class="word" :class="toneOf(losses.total)">{{ totalWord }}</p>
        <p class="note">{{ countLine }}</p>
      </div>

      <p v-if="losses" class="legend" aria-hidden="true">
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

      <!-- A bar an exchange from the line «как по рынку дня» (MOL-348, handoff 02): up — more than
           the market of its day gave, down — less, every height on one scale, the server's. The bars
           are radios, as the bars of «Графики» (MOL-156): the arrows move the choice, and the whole
           field is the finger's target — the bar under it, and a slide along them (`useChartPointer`),
           since twelve bars of a year are narrower than a finger (review №5, adversarial А5). -->
      <fieldset v-if="bars.length > 0" class="bars">
        <legend class="unseen">{{ t('exchange.vs_market.bars_legend') }}</legend>
        <div
          ref="area"
          class="plot"
          :class="{ flat: span === 0 }"
          @pointerdown="pointer.down"
          @pointermove="pointer.move"
          @pointerup="pointer.up"
          @pointercancel="pointer.cancel"
        >
          <label
            v-for="bar in bars"
            :key="bar.id"
            class="cell"
            :class="[kindOf(bar), { chosen: bar.id === chosenId }]"
          >
            <input
              type="radio"
              class="radio"
              :name="name"
              :value="bar.id"
              :checked="bar.id === chosenId"
              :aria-label="labelOf(bar)"
              @click="choose(bar.id)"
            />
            <span class="half up" :style="{ height: `${upShare}%` }" aria-hidden="true">
              <template v-if="bar.level > 0 || bar.sign !== -1">
                <span v-if="labelled(bar)" class="value">{{ valueOf(bar) }}</span>
                <span class="bar" :style="barStyle(bar)"></span>
              </template>
            </span>
            <span class="half down" aria-hidden="true">
              <template v-if="bar.level < 0 || bar.sign === -1">
                <span class="bar" :style="barStyle(bar)"></span>
                <span v-if="labelled(bar)" class="value">{{ valueOf(bar) }}</span>
              </template>
            </span>
          </label>
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
      </fieldset>

      <!-- No live region: the radio chosen says all of it (review №8). -->
      <div v-if="chosenBar" class="plate">
        <p class="plate-where">{{ whereOf(chosenBar) }}</p>
        <p class="plate-diff" :class="kindOf(chosenBar)">{{ diffOf(chosenBar) }}</p>
        <p class="plate-amounts">{{ amountsOf(chosenBar) }}</p>
        <p class="plate-word" :class="kindOf(chosenBar)">{{ wordOf(chosenBar) }}</p>
      </div>

      <p v-if="uncounted > 0" class="note">
        {{ t('exchange.vs_market.uncounted', { n: uncounted }, uncounted) }}
      </p>

      <div v-if="losses && losses.groups.length > 1" class="places">
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
            <span class="unseen">{{ t(VERDICT_WORD[verdictOfMoney(group.difference)]) }}</span>
          </li>
        </ul>
      </div>
    </template>

    <!-- Incomes alone and no exchange (handoff 3k): the kit's quiet empty state, inside the card
         (review №11). -->
    <ScreenState
      v-else
      kind="empty"
      inline
      :icon="IconSwap"
      :title="t('exchange.empty.title')"
      :body="t('exchange.vs_market.incomes_only')"
    />
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, markRaw, ref, useId } from 'vue'
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
import ScreenState from '@/components/ScreenState.vue'
import SectionCaption from '@/components/SectionCaption.vue'
import { useChartPointer } from '@/composables/useChartPointer'
import {
  toneOfVerdict,
  VERDICT_WORD,
  verdictKind,
  verdictOfMoney,
} from '@/composables/useExchangeWords'
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
 * places as bars. Every figure, height and sign is the server's (`losses`, `bars`): the line stands
 * where the furthest bar up and the furthest down share the height, and every bar is drawn on that one
 * scale — a half never stretched to fill its own height (review №3: +100 beside −1000 read as one to
 * two). The phone counts the bars by their sign for the line under the total, and names the months.
 * The tone is only the difference with the market's, never alone: the bar's direction, the sign and the
 * word stand beside it (Ф-30). One sign a row, the money's (MOL-190); an amount whole unless that prints
 * a nought for money that is there (adversarial А1 of MOL-187).
 */
export default defineComponent({
  name: 'ExchangeVsMarket',
  components: { AppCard, ScreenState, SectionCaption },
  props: {
    losses: { type: Object as PropType<ExchangeLossesView | null>, default: null },
    bars: { type: Array as PropType<readonly Bar[]>, default: () => [] },
    exchanges: { type: Array as PropType<readonly ExchangeView[]>, default: () => [] },
    /** The exchange chosen here or on the line of the rate; null — the default. */
    chosen: { type: String as PropType<string | null>, default: null },
    today: { type: String, required: true },
  },
  emits: {
    /** Every choice, the bar already chosen too: the line of the rate goes back to it (А4). */
    'update:chosen': (id: string) => typeof id === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const area = ref<HTMLElement | null>(null)

    const toneOf = (money: Money) => toneOfVerdict(verdictOfMoney(money))
    const kindOf = (bar: Bar) => verdictKind(bar.sign)
    const amountOf = (money: Money) =>
      signedAmount(money, locale.value, { plus: true, estimate: !roundsToNought(money) })

    const totalText = computed(() => (props.losses ? amountOf(props.losses.total) : ''))
    const totalWord = computed(() => {
      const total = props.losses?.total
      if (!total) return ''
      return t(
        {
          good: 'exchange.vs_market.word_better',
          bad: 'exchange.vs_market.word_worse',
          even: 'exchange.vs_market.even',
          none: 'exchange.vs_market.even',
        }[verdictOfMoney(total)],
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
    /** With no sum, nothing was measured: every bar is «без сравнения». */
    const uncounted = computed(() => props.losses?.uncounted ?? props.bars.length)

    const furthestUp = computed(() => Math.max(0, ...props.bars.map(({ level }) => level)))
    const furthestDown = computed(() => Math.max(0, ...props.bars.map(({ level }) => -level)))
    const span = computed(() => furthestUp.value + furthestDown.value)
    const hasWorse = computed(() => props.bars.some(({ sign }) => sign === -1))
    /** Where the line stands, from the top: the share of the height the bars up take. */
    const upShare = computed(() => (span.value === 0 ? 100 : (furthestUp.value * 100) / span.value))
    /**
     * A bar's height in its half. Each half is as tall as its furthest bar on the one scale, so a bar
     * is its share of it; the values stand in the room the field keeps over and under the bars.
     */
    function barStyle(bar: Bar): Record<string, string> {
      // «Без сравнения» is a dashed frame of its own size on the line, no height of the money.
      if (bar.sign === null) return {}
      const furthest = bar.level < 0 ? furthestDown.value : furthestUp.value
      const share = furthest === 0 ? 0 : (Math.abs(bar.level) * 100) / furthest
      return { height: `max(${String(LEAST_PX)}px, ${String(share)}%)` }
    }

    // The screen names the choice — the latest exchange by default, as the line of the rate (Б2) — and
    // the card falls back to the same only for a choice it has no bar of.
    const chosenId = computed(() => {
      if (props.chosen && props.bars.some(({ id }) => id === props.chosen)) return props.chosen
      return props.bars.at(-1)?.id ?? null
    })
    const chosenBar = computed(() => props.bars.find(({ id }) => id === chosenId.value) ?? null)
    const choose = (id: string) => {
      emit('update:chosen', id)
    }

    /**
     * One action, one choice (review №16): a tap and a key reach the radio as its `click` — the bar
     * already chosen too, so the line of the rate comes back to it (А4) — and the field takes only a
     * finger sliding along the bars, a bar as it comes under it. The field is cut into as many columns
     * as there are bars.
     */
    const pointer = useChartPointer(area, (fraction, point) => {
      if (point.tap) return
      const n = props.bars.length
      const bar = props.bars[Math.min(n - 1, Math.floor(fraction * n))]
      if (bar && bar.id !== chosenId.value) choose(bar.id)
    })

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
      const kind = kindOf(bar)
      if (kind === 'none') return t('exchange.vs_market.none_said')
      const word = t(VERDICT_WORD[kind])
      return bar.percent === null || kind === 'even'
        ? word
        : `${signedPercent(bar.percent, locale.value, true)} · ${word}`
    }
    const labelOf = (bar: Bar) =>
      [whereOf(bar), diffOf(bar), wordOf(bar)].filter((part) => part !== '').join(': ')

    const widthOf = (level: number) => `${String((Math.abs(level) * 100) / CHART_LEVEL)}%`

    return {
      t,
      locale,
      area,
      name: useId(),
      headingId: useId(),
      IconSwap: markRaw(IconSwap),
      VERDICT_WORD,
      verdictOfMoney,
      figureChars,
      signedPercent,
      toneOf,
      kindOf,
      amountOf,
      totalText,
      totalWord,
      countLine,
      uncounted,
      span,
      hasWorse,
      upShare,
      barStyle,
      chosenId,
      chosenBar,
      choose,
      pointer,
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

.bars {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.unseen,
.radio {
  @include visually-hidden;
}

/* The whole field is the target (`useChartPointer`); `pan-y` leaves the page its scroll. */
.plot {
  display: flex;
  flex-direction: row;
  height: 11rem;
  touch-action: pan-y;

  /* Every bar on the line, none measured: the frames and their «?», no height to give. */
  &.flat {
    height: 5rem;
  }
}

/* The room over and under the bars is the values': a bar as tall as its half leaves its value there. */
.cell {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  padding: calc(var(--space-8) + var(--space-2)) 0 var(--space-8);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:has(.radio:focus-visible) {
    @include focus-ring;

    border-radius: var(--radius-sm);
  }
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

  /* Chosen is the bar's ring; the month only darkens, at the same weight (MOL-179, review №9). */
  &.chosen {
    color: var(--text);
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
</style>
