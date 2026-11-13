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
          :class="{ flat: span === 0, 'none-down': !hasWorse }"
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
                <span
                  v-if="labelled(bar)"
                  class="value"
                  :class="places[`value:${bar.id}`]"
                  :data-label="`value:${bar.id}`"
                  ><span class="label">{{ valueOf(bar) }}</span></span
                >
                <span class="bar" :style="barStyle(bar)"></span>
              </template>
            </span>
            <span class="half down" aria-hidden="true">
              <template v-if="bar.level < 0 || bar.sign === -1">
                <span class="bar" :style="barStyle(bar)"></span>
                <span
                  v-if="labelled(bar)"
                  class="value"
                  :class="places[`value:${bar.id}`]"
                  :data-label="`value:${bar.id}`"
                  ><span class="label">{{ valueOf(bar) }}</span></span
                >
              </template>
            </span>
          </label>
        </div>
        <p ref="monthsRow" class="months" aria-hidden="true">
          <span
            v-for="bar in bars"
            :key="bar.id"
            class="month"
            :class="[places[`month:${bar.id}`], { chosen: bar.id === chosenId }]"
            :data-label="monthLabelled(bar) ? `month:${bar.id}` : undefined"
            ><span v-if="monthLabelled(bar)" class="label">{{
              monthOf(bar.exchangedOn)
            }}</span></span
          >
        </p>
      </fieldset>

      <!-- No live region: the radio chosen says all of it (review №8). Only the chosen bar's plate, at its
           own height: no room is held for a taller one, and a choice moves what stands under the plate —
           the page stretches rather than keep empty room (MOL-404, the owner's word; Г1 of MOL-348 before). -->
      <div v-if="chosenBar" class="plate">
        <p class="plate-where">{{ whereOf(chosenBar) }}</p>
        <p class="plate-diff" :class="kindOf(chosenBar)">{{ diffOf(chosenBar) }}</p>
        <!-- Each sum a piece of its own, so the words break between them, never inside one. -->
        <p class="plate-amounts">
          <template v-for="(part, index) in amountsOf(chosenBar)" :key="index"
            ><span v-if="part.sum" class="sum" :style="figureChars(part.text, 'text')">{{
              part.text
            }}</span
            ><template v-else>{{ part.text }}</template></template
          >
        </p>
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
import { CHART_LEVEL, decimalFromMinor } from '@molvia/model'
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
  useExchangeWords,
  VERDICT_WORD,
  verdictKind,
  verdictOfMoney,
} from '@/composables/useExchangeWords'
import type { AmountPart } from '@/composables/useExchangeWords'
import { apart, laidOn, useLabelPlaces } from '@/composables/useLabelPlaces'
import type { LabelBox, LabelEdge } from '@/composables/useLabelPlaces'
import { calendarDay, calendarDayOfAnyYear } from '@/days'

type Bar = NonNullable<ExchangesResponse['bars']>[number]
/** A label laid from its column's edge inward, or given way to a neighbour (MOL-404). */
type LabelPlace = LabelEdge | 'gone'

/** Every value over the bars up to six (handoff 02), past it the chosen bar's and the furthest's — those with room. */
const LABELLED_AT_MOST = 6
/** Every month under the bars up to eight, past it the first and the last — those with room (MOL-404, В-2 «а»). */
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
    const { amountPartsOf } = useExchangeWords()
    const area = ref<HTMLElement | null>(null)
    const monthsRow = ref<HTMLElement | null>(null)

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

    // The screen names the choice, its default too (`defaultExchange`, review №19); a choice the card has
    // no bar of — or none, as a test mounts it alone — stands on the latest bar.
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
    // Past eight, the first and the last only: the chosen bar's day is on its plate (MOL-404, В-2 «а»).
    const monthLabelled = (bar: Bar) =>
      props.bars.length <= MONTHS_AT_MOST ||
      bar.id === props.bars[0]?.id ||
      bar.id === props.bars.at(-1)?.id
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
    /** «Отдал → получил», cut around its two sums: a sum stands whole (MOL-321). */
    function amountsOf(bar: Bar): readonly AmountPart[] {
      const exchange = exchangeOf(bar)
      return exchange ? amountPartsOf(exchange) : []
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

    /**
     * Where each label stands, measured (MOL-404, review №1–2, adversarial А1–А3): a label never wraps, so wider than
     * its column it stood over its neighbours and, a column in from the edge, past the card — by the count of bars
     * alone, eight months at 200 % ran into each other, and the chosen value beside the furthest lay on it. A label is
     * centred on its column while that keeps it in the field, else laid from its column's edge inward (`laidOn`); of
     * two that would run into each other — across, or one over the other: a value over the line and one under it stand
     * apart (round 2, Б1) — the one later in the order gives way. The months: the first, the last, then from the left.
     * The values up to six: the furthest, then by size — a choice moves none, as a finger slides along them (Б2); past
     * six only the chosen bar's and the furthest's are labelled, the chosen first, its value on its plate too.
     */
    function placeLabels(): Record<string, LabelPlace[]> {
      const next: Record<string, LabelPlace[]> = {}
      const byLevel = [...props.bars].sort((a, b) => Math.abs(b.level) - Math.abs(a.level))
      const values =
        props.bars.length <= LABELLED_AT_MOST
          ? [widest.value, ...byLevel]
          : [chosenBar.value, widest.value]
      const months = [props.bars[0], props.bars.at(-1), ...props.bars]
      for (const [row, kind, order] of [
        [area.value, 'value', values],
        [monthsRow.value, 'month', months],
      ] as const) {
        if (!row) continue
        const field = row.getBoundingClientRect()
        const nodes = new Map(
          [...row.querySelectorAll<HTMLElement>('[data-label]')].map((node) => [
            node.dataset.label,
            node,
          ]),
        )
        const kept: LabelBox[] = []
        const seen = new Set<string>()
        for (const bar of order) {
          const key = `${kind}:${bar?.id ?? ''}`
          const node = nodes.get(key)
          const label = node?.querySelector('.label')
          if (!node || !label || seen.has(key)) continue
          seen.add(key)
          const column = node.getBoundingClientRect()
          const own = label.getBoundingClientRect()
          const from = column.left - field.left
          const { left, right, edge } = laidOn(from, from + column.width, own.width, field.width)
          // Its height is its own wherever it is laid across: the place moves it only along the row.
          const box = { left, right, top: own.top - field.top, bottom: own.bottom - field.top }
          // Given way, it keeps its edge too: unseen past the card, it still widened what scrolls.
          const place: LabelPlace[] = edge ? [edge] : []
          if (kept.every((one) => apart(one, box))) kept.push(box)
          else place.push('gone')
          if (place.length > 0) next[key] = place
        }
      }
      return next
    }
    /** The labels laid from an edge or given way, by `value:<id>` and `month:<id>`. */
    const places = useLabelPlaces(area, placeLabels, {}, [() => props.bars, chosenId, locale])

    return {
      t,
      locale,
      area,
      monthsRow,
      places,
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
/* The plate turns by the card's width (below). */
.vs-market {
  container: vs-market / inline-size;
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

/* One column of the card's width, never the bars' own: as `auto`, forty-one frames of «без сравнения» at
   14 px stood the field 590 px wide on a phone of 320 (MOL-404). */
.bars {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
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

/* Every bar on the line, none measured: the frames and their «?», no height to give. */
$flat-height: 5rem;

/* The whole field is the target (`useChartPointer`); `pan-y` leaves the page its scroll. */
.plot {
  display: flex;

  /* A stacking context of its own: the values' z-index lifts them over the bars, never over the page (BarChart's). */
  isolation: isolate;
  flex-direction: row;
  height: 11rem;
  touch-action: pan-y;

  &.flat {
    height: $flat-height;
  }
}

/* No bar down, no value under the line: the room kept for one goes (MOL-404, the owner's «no empty space») —
   to the bars, or, with every bar on the line, out of the field. */
.none-down .cell {
  padding-bottom: 0;
}

.flat.none-down {
  height: calc(#{$flat-height} - var(--space-8));
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

/* A square of 14, narrower with its column, as a bar is. */
.none .bar {
  width: min(14px, 70%);
  aspect-ratio: 1;
  border: 1.5px dashed var(--graphic);
  border-radius: var(--radius-mark);
}

.chosen .bar {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/*
 * A label of a bar — its value, its month — never wraps: a column of 8 px broke «нояб» a letter a line
 * (MOL-404). It stands in a row as wide as its column, centred on it — over both sides where it is wider —
 * and laid from the column's edge inward where centred it would stand past the field, or unseen where it
 * would run into a neighbour (`placeLabels`, measured).
 */
.value,
.month {
  display: flex;
  justify-content: center;
  white-space: nowrap;

  &.start {
    justify-content: flex-start;
  }

  &.end {
    justify-content: flex-end;
  }

  &.gone .label {
    visibility: hidden;
  }
}

.value {
  align-self: stretch;
  padding: var(--space-1) 0;
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;

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

  /* Over the bars, on the card's own ground: wider than its column at large text, a value crosses its neighbours, and
     a bar later in the row was drawn over it — «−3 456 ֏» lost its «֏» at 200 % (round 3, В2). The bar breaks under it. */
  .label {
    position: relative;
    z-index: 1;
    border-radius: var(--radius-mark);
    background: var(--surface);
    box-shadow: 0 0 0 2px var(--surface);
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

  /* Chosen is the bar's ring; the month only darkens, at the same weight (MOL-179, review №9). */
  &.chosen {
    color: var(--text);
  }
}

/* The right column — the difference and its word — takes at most half: as `auto`, «без сравнения · рынка
   или курса того дня нет» took the whole plate and stood the place and the amounts a letter a line (MOL-404). */
.plate {
  display: grid;
  grid-template-columns: minmax(0, 1fr) fit-content(50%);
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

.sum {
  white-space: nowrap;
}

.plate-word {
  font-size: var(--text-footnote);
  text-align: right;

  &.none,
  &.even {
    color: var(--text);
  }
}

/* With large text the card is narrower than a list card's row keeps its tail beside (`$row-tight`): the
   difference never breaks and «сравнения» is a word, so beside the place they left it no width at all, and
   the plate stands its four lines one under another (MOL-404, MOL-321). */
@container vs-market (width < #{$row-tight}) {
  .plate {
    grid-template-columns: minmax(0, 1fr);
    padding-inline: var(--space-3);
  }

  /* A sum shrunk to the plate where even it alone is wider (`figure-fit`, MOL-321). */
  .sum {
    @include figure-fit(1em, $less: calc(2 * var(--space-3)));
  }

  .plate-diff,
  .plate-word {
    text-align: left;
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
