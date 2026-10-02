<template>
  <AppCard v-if="pair" as="section" class="rate-chart" :aria-labelledby="headingId">
    <h2 :id="headingId" class="caption">{{ t(`exchange.rate_chart.title.${pair.currency}`) }}</h2>
    <p class="legend" aria-hidden="true">
      <span class="key"
        ><span class="swatch line"></span>{{ t('exchange.rate_chart.legend_market') }}</span
      >
      <span class="key"
        ><span class="swatch dot"></span>{{ t('exchange.rate_chart.legend_mine') }}</span
      >
    </p>

    <!-- Only when there is a choice (handoff 05): one pair needs no control. -->
    <SegmentedControl
      v-if="chart.pairs.length > 1"
      class="pairs"
      :model-value="pair.currency"
      :options="pairOptions"
      :legend="t('exchange.rate_chart.pair')"
      hide-legend
      @update:model-value="choosePair"
    />

    <!-- The reading is not a live region: the radio chosen says the same (MOL-74, Р-6 of MOL-157). -->
    <div class="reading">
      <template v-if="week">
        <p class="week">{{ t('exchange.rate_chart.week', { day: shortDay(week.day) }) }}</p>
        <p v-if="week.rate" class="figure">{{ rateOf(week.rate) }}</p>
        <p v-else class="figure missing">{{ t('exchange.rate_chart.no_market') }}</p>
      </template>
      <p v-if="chosen?.exchange" class="mine">
        <span class="mine-dot" aria-hidden="true"></span>
        <span class="mine-text">
          <span class="mine-rate">{{
            t('exchange.rate_chart.mine', {
              day: shortDay(chosen.exchange.day),
              rate: rateOf(chosen.exchange.rate),
            })
          }}</span>
          <span class="mine-place">{{ placeLineOf(chosen.exchange) }}</span>
        </span>
      </p>
      <p v-else class="none">
        {{
          pair.exchanges.length === 0
            ? t('exchange.rate_chart.none_year')
            : t('exchange.rate_chart.none')
        }}
      </p>
    </div>

    <fieldset class="chart">
      <legend class="unseen">{{ t(`exchange.rate_chart.title.${pair.currency}`) }}</legend>
      <div class="plot-row">
        <div
          ref="area"
          class="area"
          @pointerdown="pointer.down"
          @pointermove="pointer.move"
          @pointerup="pointer.up"
          @pointercancel="pointer.cancel"
        >
          <svg class="plot" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <line
              v-for="tick in pair.levels"
              :key="tick.level"
              class="grid"
              x1="0"
              :y1="yOf(tick.level)"
              x2="1000"
              :y2="yOf(tick.level)"
              vector-effect="non-scaling-stroke"
            />
            <line
              v-if="chosen"
              class="cursor"
              :x1="cursorX"
              y1="0"
              :x2="cursorX"
              y2="1000"
              vector-effect="non-scaling-stroke"
            />
            <polyline
              v-for="(run, index) in runs"
              :key="index"
              class="line"
              :points="run"
              vector-effect="non-scaling-stroke"
            />
            <template v-if="week && week.level !== null">
              <line
                v-for="part in ['ring', 'hole']"
                :key="part"
                :class="part"
                :x1="week.x"
                :y1="yOf(week.level)"
                :x2="week.x"
                :y2="yOf(week.level)"
                vector-effect="non-scaling-stroke"
              />
            </template>
            <!-- The mark ends at the market the exchange was measured by (В-1), never at the line:
                 a cash exchange is set beside cash, which the line of all bank clients is not. -->
            <template v-for="point in pair.exchanges" :key="`mark-${point.id}`">
              <template v-if="point.market">
                <line
                  class="mark"
                  :x1="point.x"
                  :y1="yOf(point.level)"
                  :x2="point.x"
                  :y2="yOf(point.market.level)"
                  vector-effect="non-scaling-stroke"
                />
                <line
                  class="mark end"
                  :x1="point.x - TICK"
                  :y1="yOf(point.market.level)"
                  :x2="point.x + TICK"
                  :y2="yOf(point.market.level)"
                  vector-effect="non-scaling-stroke"
                />
              </template>
            </template>
            <!-- A dot is a zero-length round-capped line: stretched with the plot, it stays round. -->
            <template v-for="point in pair.exchanges" :key="point.id">
              <line
                v-for="part in ['halo', 'point']"
                :key="part"
                :class="[part, { chosen: chosen?.exchange?.id === point.id }]"
                :x1="point.x"
                :y1="yOf(point.level)"
                :x2="point.x"
                :y2="yOf(point.level)"
                vector-effect="non-scaling-stroke"
              />
            </template>
          </svg>
          <label v-for="(item, index) in items" :key="item.key" class="unseen">
            <input
              type="radio"
              :name="name"
              :value="index"
              :checked="index === chosenIndex"
              :aria-label="item.spoken"
              @change="choose(index)"
            />
          </label>
        </div>
        <div class="axis" aria-hidden="true">
          <span
            v-for="tick in pair.levels"
            :key="tick.level"
            class="level"
            :style="{ top: `${String(yOf(tick.level) / 10)}%` }"
          >
            {{ tickOf(tick.rate) }}
          </span>
        </div>
      </div>
      <div class="months-row" aria-hidden="true">
        <div class="months">
          <span
            v-for="label in monthLabels"
            :key="label.month"
            class="month"
            :style="{ left: `${String(label.x / 10)}%` }"
          >
            {{ label.text }}
          </span>
        </div>
      </div>
    </fieldset>

    <p class="note">{{ t(`exchange.rate_chart.note_${pair.side}`) }}</p>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHART_LEVEL, RATE_SCALE, currencySign, decimalFromRate, formatRate } from '@molvia/model'
import type { ExchangeRate, ExchangeRateChartView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { shortMonth, signedPercent } from '@/components/charts'
import { useChartPointer } from '@/composables/useChartPointer'
import { calendarDay } from '@/days'

type Pair = ExchangeRateChartView['pairs'][number]
type Point = Pair['exchanges'][number]

/** What can be chosen: a week with no exchange, or each exchange of a week (Р-6). */
interface Item {
  readonly key: string
  readonly week: number
  readonly exchange: Point | null
  readonly spoken: string
}

/** The line keeps a twentieth of the plot clear above and below, so no dot is cut. */
const MARGIN = 50
/** Half the end of the mark, in thousandths of the plot's width. */
const TICK = 14

/**
 * «Курс рубля за 12 месяцев» (MOL-161, handoff MOL-157 05, frames 6c and 6d): the market of all
 * bank clients at the end of each week — the only row with a year of history, and the legend says
 * so (Р-3) — the person's exchanges as dots on their own day, and from each a mark to the market it
 * was measured by (В-1), so the mark and the percent always say the same. A choice is made as a bar
 * is — on lifting the finger or once it goes sideways — the nearest exchange by its day or week with
 * none by its end; by default the latest exchange. Hidden radios, one per week with no exchange and one per
 * exchange, give the keyboard and a screen reader every choice. Every height is the server's.
 */
export default defineComponent({
  name: 'ExchangeRateChart',
  components: { AppCard, SegmentedControl },
  props: {
    chart: { type: Object as PropType<ExchangeRateChartView>, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const area = ref<HTMLElement | null>(null)
    const currency = ref<Pair['currency'] | null>(null)
    const chosenKey = ref<string | null>(null)

    const pair = computed<Pair | null>(
      () =>
        props.chart.pairs.find((one) => one.currency === currency.value) ??
        props.chart.pairs[0] ??
        null,
    )

    const rateOf = (rate: ExchangeRate) => formatRate(rate, locale.value)
    const shortDay = (day: string) =>
      calendarDay(day, locale.value, { day: 'numeric', month: 'short' })
    const longDay = (day: string) => calendarDay(day, locale.value)
    const changeOf = (point: Point) =>
      point.percent === null
        ? t('exchange.rate_chart.no_change')
        : signedPercent(point.percent, locale.value, true)

    function placeLineOf(point: Point): string {
      const place = point.place ?? t('exchange.vs_market.no_place')
      return point.percent === null
        ? t('exchange.rate_chart.mine_no_market', { place })
        : t('exchange.rate_chart.mine_place', { place, change: changeOf(point) })
    }

    const items = computed<Item[]>(() => {
      const shown = pair.value
      if (!shown) return []
      return shown.weeks.flatMap((week, index): Item[] => {
        const market = week.rate
          ? t('exchange.rate_chart.spoken_market', { rate: rateOf(week.rate) })
          : t('exchange.rate_chart.spoken_no_market')
        const day = longDay(week.day)
        const points = shown.exchanges.filter((point) => point.week === index)
        if (points.length === 0) {
          return [
            {
              key: `week-${week.day}`,
              week: index,
              exchange: null,
              spoken: t('exchange.rate_chart.spoken', { day, market }),
            },
          ]
        }
        return points.map((point) => ({
          key: point.id,
          week: index,
          exchange: point,
          spoken: t('exchange.rate_chart.spoken_mine', {
            day,
            market,
            date: longDay(point.day),
            mine: rateOf(point.rate),
            change: changeOf(point),
          }),
        }))
      })
    })

    /** The latest exchange, or the latest week when there is none. */
    function defaultIndex(): number {
      const all = items.value
      for (let index = all.length - 1; index >= 0; index -= 1) {
        if (all[index]?.exchange) return index
      }
      return all.length - 1
    }

    // A new answer keeps the choice while it still has it; another pair starts afresh.
    const chosenIndex = computed(() => {
      const found = items.value.findIndex((item) => item.key === chosenKey.value)
      return found === -1 ? defaultIndex() : found
    })
    const chosen = computed(() => items.value[chosenIndex.value] ?? null)
    const week = computed(
      () => (chosen.value ? pair.value?.weeks[chosen.value.week] : null) ?? null,
    )
    const cursorX = computed(() => chosen.value?.exchange?.x ?? week.value?.x ?? 0)

    watch(
      () => pair.value?.currency,
      () => {
        chosenKey.value = null
      },
    )

    function choose(index: number): void {
      const item = items.value[index]
      if (item) chosenKey.value = item.key
    }

    function choosePair(value: string): void {
      currency.value = props.chart.pairs.find((one) => one.currency === value)?.currency ?? null
    }

    /**
     * The nearest of what can be chosen, each by its own place on the line: an exchange by its day,
     * a week with none by its end (review 1). Found through the week first, a tap right on an
     * exchange of a Monday chose the week before, whose end lies nearer.
     */
    const pointer = useChartPointer(area, (fraction) => {
      const shown = pair.value
      if (!shown) return
      const x = fraction * 1000
      let nearest = -1
      let distance = Infinity
      items.value.forEach((item, index) => {
        const away = Math.abs((item.exchange?.x ?? shown.weeks[item.week]?.x ?? 0) - x)
        if (away < distance) {
          nearest = index
          distance = away
        }
      })
      choose(nearest)
    })

    const yOf = (level: number) => 1000 - MARGIN - (level * (1000 - 2 * MARGIN)) / CHART_LEVEL

    /** The line in runs: a week with no figure is a gap, never a zero. */
    const runs = computed(() => {
      const all: string[][] = [[]]
      for (const week of pair.value?.weeks ?? []) {
        if (week.level === null) all.push([])
        else all.at(-1)?.push(`${String(week.x)},${String(yOf(week.level))}`)
      }
      return all.filter((run) => run.length > 1).map((run) => run.join(' '))
    })

    /** «4,30» — the tick alone; whole when every tick is whole, «386» for the dollar. */
    function tickOf(rate: ExchangeRate): string {
      const whole = (pair.value?.levels ?? []).every((tick) => tick.rate.scaled % RATE_SCALE === 0n)
      return new Intl.NumberFormat(locale.value, {
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: 2,
      }).format(decimalFromRate(rate.scaled))
    }

    /** «окт · янв · апр · июл · сен»: the first, every third month after it, and the last. */
    const monthLabels = computed(() => {
      const firsts: { month: string; x: number }[] = []
      for (const week of pair.value?.weeks ?? []) {
        const month = week.day.slice(0, 7)
        if (firsts.at(-1)?.month !== month) firsts.push({ month, x: week.x })
      }
      // The last only two months past a label: one month on, the two would run into each other.
      const last = firsts.length - 1
      return firsts
        .filter((_, index) => index % 3 === 0 || (index === last && last % 3 === 2))
        .map((label) => ({ ...label, text: shortMonth(label.month, locale.value) }))
    })

    const pairOptions = computed(() =>
      props.chart.pairs.map((one) => ({
        value: one.currency,
        label: t('exchange.rate_chart.pair_option', {
          currency: currencySign(one.currency, locale.value),
          dram: currencySign('AMD', locale.value),
        }),
      })),
    )

    return {
      t,
      headingId: useId(),
      name: useId(),
      area,
      pair,
      items,
      chosen,
      chosenIndex,
      week,
      cursorX,
      runs,
      monthLabels,
      pairOptions,
      TICK,
      yOf,
      rateOf,
      shortDay,
      tickOf,
      placeLineOf,
      choose,
      choosePair,
      pointer,
    }
  },
})
</script>

<style scoped lang="scss">
.rate-chart {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

.caption {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.key {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.swatch.line {
  width: 1rem;
  height: 2px;
  background: var(--text-muted);
}

/* The series differ in shape — a line and a ringed dot — not in colour alone. */
.swatch.dot {
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
  background: var(--accent);
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 3px var(--accent);
}

.reading {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  min-height: 6rem;
}

.week,
.none {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 800;
  font-variant-numeric: tabular-nums;

  &.missing {
    color: var(--text-muted);
    font-size: var(--text-callout);
    font-weight: var(--weight-medium);
  }
}

.mine {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  justify-self: start;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.mine-dot {
  flex-shrink: 0;
  width: 0.5rem;
  height: 0.5rem;
  margin-top: var(--space-1);
  border-radius: 50%;
  background: var(--accent);
}

.mine-text {
  display: grid;
  font-size: var(--text-footnote);
}

.mine-rate {
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.mine-place {
  color: var(--text-muted);
}

.chart {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.unseen {
  @include visually-hidden;
}

.plot-row,
.months-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 2.5rem;
  gap: var(--space-2);
}

.area {
  position: relative;
  height: 11.25rem;
  border-radius: var(--radius-sm);
  touch-action: pan-y;

  &:has(input:focus-visible) {
    @include focus-ring;
  }
}

.plot {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.grid {
  stroke: var(--border);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.cursor {
  stroke: var(--border-strong);
  stroke-width: 1.5;
}

.line {
  fill: none;
  stroke: var(--text-muted);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.mark {
  stroke: var(--text);
  stroke-width: 1.5;

  &.end {
    stroke-width: 2;
  }
}

.ring,
.hole {
  stroke: var(--text-muted);
  stroke-width: 9;
  stroke-linecap: round;
}

.hole {
  stroke: var(--surface);
  stroke-width: 5;
}

.halo,
.point {
  stroke-linecap: round;
}

.halo {
  stroke: var(--surface);
  stroke-width: 14;

  &.chosen {
    stroke-width: 17;
  }
}

.point {
  stroke: var(--accent);
  stroke-width: 10;

  &.chosen {
    stroke-width: 13;
  }
}

.axis {
  position: relative;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

.level {
  position: absolute;
  left: 0;
  transform: translateY(-50%);
}

.months {
  position: relative;
  height: 1lh;
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
}

.month {
  position: absolute;
  transform: translateX(-50%);

  &:first-child {
    transform: none;
  }

  &:last-child {
    transform: translateX(-100%);
  }
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
