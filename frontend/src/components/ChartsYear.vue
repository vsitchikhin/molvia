<template>
  <MonthSwitcher
    unit="year"
    :month="year"
    :current="current"
    :first="first"
    @change="(value: string) => $emit('change', value)"
  />
  <!-- Under the switcher: it is about the year chosen, and over it they came and went with its
       answer and took it from under the thumb (MOL-138, owner's В-2). -->
  <StatusStrip
    v-if="stale === 'offline' && fetchedAt"
    kind="offline"
    :text="t('spending.charts.offline.strip', { when: when(fetchedAt) })"
  />
  <StatusStrip
    v-else-if="stale === 'error' && fetchedAt"
    kind="unanswered"
    :text="t('spending.charts.error_strip', { when: when(fetchedAt) })"
    :attempt="attempt"
  >
    <!-- The charts have no action of their own in the strip over the tab bar, so «Повторить» is the
         strip's (MOL-181, Р-1). -->
    <template #action>
      <AppButton variant="ghost" @click="retry">{{ t('state.retry') }}</AppButton>
    </template>
  </StatusStrip>

  <ChartsSkeleton v-if="phase === 'loading'" year />

  <ScreenState
    v-else-if="phase === 'error'"
    kind="error"
    :title="t('spending.charts.load_error.title')"
    :body="t('spending.charts.load_error.body')"
    @retry="retry"
  />

  <ScreenState
    v-else-if="phase === 'offline'"
    kind="offline"
    tone="warn"
    :title="t('spending.offline.title')"
    :body="t('spending.charts.offline.body')"
  />

  <template v-else-if="charts">
    <ScreenState
      v-if="charts.firstMonth === null"
      kind="empty"
      :icon="IconDonut"
      :title="t('spending.charts.empty.title')"
      :body="t('spending.charts.empty.body')"
    />

    <template v-else>
      <DonutChart
        v-if="ring"
        v-model="sector"
        class="answer"
        :charts="ring"
        :label="centreLabel"
        :note="both ? t('spending.charts.year_rate_note') : null"
        :no-rate="noRate"
        :name-of="nameOf"
      />

      <AppCard as="section" class="chart-card" :aria-labelledby="`${id}-spent`">
        <SectionCaption :id="`${id}-spent`" inset>{{
          t('spending.charts.spent_title')
        }}</SectionCaption>
        <BarChart
          v-model="spentAt"
          :bars="spentBars"
          :legend="t('spending.charts.spent_title')"
          :average="charts.average?.level ?? null"
        >
          <template v-if="spentMonth">
            <p class="month">{{ monthLabel(spentMonth.month) }}</p>
            <p class="figure">{{ whole(spentMonth.spent) }}</p>
            <p class="detail">{{ spentDetail }}</p>
          </template>
        </BarChart>
        <p class="hint" :class="{ dashed: charts.average }">{{ averageNote }}</p>
        <p class="hint">{{ t('spending.charts.spent_hint') }}</p>
      </AppCard>

      <AppCard as="section" class="chart-card" :aria-labelledby="`${id}-flow`">
        <div class="head">
          <SectionCaption :id="`${id}-flow`" inset>{{
            t('spending.charts.income_title')
          }}</SectionCaption>
          <p class="legend" aria-hidden="true">
            <span class="key outline"></span>{{ t('spending.income') }}
            <span class="key filled"></span>{{ t('spending.charts.spent_legend') }}
          </p>
        </div>
        <BarChart
          v-model="flowAt"
          :bars="flowBars"
          :legend="t('spending.charts.income_title')"
          paired
        >
          <template v-if="flowMonth">
            <div class="columns">
              <p class="column">
                <span class="label">{{ t('spending.income') }}</span>
                <span class="value">{{ whole(flowMonth.income) }}</span>
              </p>
              <p class="column">
                <span class="label">{{ t('spending.charts.spent_legend') }}</span>
                <span class="value" :class="{ words: flowMonth.spentIncome === null }">
                  {{ outOf(flowMonth) }}
                </span>
              </p>
              <p class="column">
                <span class="label">
                  {{
                    t('spending.charts.difference', {
                      month: shortMonth(flowMonth.month, locale),
                    })
                  }}
                </span>
                <!-- Never red: spending past what came in is no error, and its sign says it (С-16). -->
                <span class="value" :class="{ words: flowMonth.difference === null }">
                  {{ differenceOf(flowMonth) }}
                </span>
              </p>
            </div>
            <p v-for="line in flowUncounted" :key="line" class="detail">{{ line }}</p>
          </template>
        </BarChart>
        <p class="hint">{{ flowNote }}</p>
      </AppCard>

      <AppCard v-if="series" as="section" class="chart-card" :aria-labelledby="`${id}-category`">
        <SectionCaption :id="`${id}-category`" inset>
          {{ t('spending.charts.category_months_title') }}
        </SectionCaption>
        <AppField
          :model-value="series.category.id"
          kind="select"
          :label="t('spending.sheet.category')"
          :options="categoryOptions"
          hide-label
          class="category"
          @update:model-value="chooseFromList"
        >
          <template #lead>
            <span class="dot" :style="{ background: categoryColour(series.category) }"></span>
          </template>
        </AppField>
        <!-- Under the choice it explains: choosing another does not move the choice. -->
        <p v-if="categoryMissing" class="detail missing">
          {{ t('spending.charts.category_missing', { name: nameOf(series.category) }) }}
        </p>
        <BarChart
          v-model="categoryAt"
          :bars="categoryBars"
          :legend="t('spending.charts.category_months_title')"
          :colour="categoryColour(series.category)"
          :average="series.averageLevel"
          short
        >
          <div v-if="categoryPoint" class="split">
            <p>
              <span class="month">{{ monthLabel(categoryPoint.month) }}</span>
              <span class="figure small">{{ whole(categoryPoint.amount) }}</span>
            </p>
            <p v-if="categoryDetail" class="detail right">{{ categoryDetail }}</p>
          </div>
        </BarChart>
        <p v-if="series.average" class="hint">{{ t('spending.charts.category_avg') }}</p>
      </AppCard>
    </template>
  </template>
</template>

<script lang="ts">
import { computed, defineComponent, ref, toRef, useId, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconDonut from '~icons/mdi/chart-donut'
import { formatEstimate, previousMonth } from '@molvia/model'
import type { Money, MoneyChartYearView, SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import BarChart from '@/components/BarChart.vue'
import type { ChartBar } from '@/components/BarChart.vue'
import ChartsSkeleton from '@/components/ChartsSkeleton.vue'
import DonutChart from '@/components/DonutChart.vue'
import type { DonutData } from '@/components/DonutChart.vue'
import MonthSwitcher from '@/components/MonthSwitcher.vue'
import ScreenState from '@/components/ScreenState.vue'
import { countedWhen, signedAmount } from '@/components/accounts'
import {
  longMonth,
  monthGenitive,
  monthName,
  monthSpan,
  shortMonth,
  signedPercent,
} from '@/components/charts'
import { asTyped, categoryColour } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import { useLocalDay } from '@/composables/useLocalDay'
import { useMoneyChartYear } from '@/composables/useMoneyCharts'
import { calendarDay } from '@/days'

type YearMonth = MoneyChartYearView['months'][number]

/**
 * The category last chosen, for as long as the app is open (handoff 03, «в памяти вкладки»), for a
 * way in that names none. A category in the address comes first (MOL-156, adversarial round 2, Д).
 */
let lastCategory: string | null = null

/**
 * «Графики → Год» (MOL-160, handoff MOL-157 04): «‹ 2026 ›», the calendar year's ring, its twelve
 * months against the usual month as a dashed line, what came in and went out, and a category by
 * month. Every figure and every height is the server's; the screen chooses a bar, a sector and
 * words. **A sector chosen on the ring chooses its category below** (owner's decision В-3), through
 * the address like any choice of the category, and nothing scrolls; letting it go changes nothing.
 * The year and the category are in the address and move by `replace`; the bars and the sector are
 * the screen's (Р-8).
 */
export default defineComponent({
  name: 'ChartsYear',
  components: {
    AppButton,
    AppCard,
    AppField,
    BarChart,
    ChartsSkeleton,
    DonutChart,
    MonthSwitcher,
    ScreenState,
    SectionCaption,
    StatusStrip,
  },
  props: {
    year: { type: String, required: true },
    /** This year on the phone: the last one there is to see. */
    current: { type: String, required: true },
  },
  emits: {
    change: (year: string) => typeof year === 'string',
  },
  setup(props) {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()
    const today = useLocalDay()
    const { phase, charts, stale, fetchedAt, attempt, kept, retry } = useMoneyChartYear(
      toRef(props, 'year'),
    )

    const whole = (value: Money) => formatEstimate(value, locale.value)
    /** What no rate counted, as written: no «≈» stands before it (MOL-184, adversarial Б1). */
    const written = (amounts: readonly Money[]) =>
      amounts.map((amount) => asTyped(amount, locale.value)).join(', ')
    const approx = (value: Money | null) =>
      value ? `≈ ${whole(value)}` : t('spending.charts.no_rate')
    const signedApprox = (value: Money) =>
      `≈ ${signedAmount(value, locale.value, { plus: true, estimate: true })}`
    const when = (at: Date) => countedWhen(at, locale.value)
    const nameOf = (category: SpendingCategoryView) =>
      category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
    const both = computed(() => charts.value?.spendCurrency !== charts.value?.incomeCurrency)
    /**
     * «Ушло» of «Пришло и ушло» in the income currency, «≈» only where a rate converted something of it —
     * the server's word (`spentEstimated`), never a guess from the currencies: one who earns and spends
     * in drams has exact drams, unless a spending in dollars came in by its day's rate (MOL-184,
     * adversarial В1, В2, Г1). «Разница» is «≈» where either side is (Г2).
     */
    const outOf = (month: YearMonth) =>
      month.spentIncome && !month.spentEstimated
        ? whole(month.spentIncome)
        : approx(month.spentIncome)

    /**
     * The first year with anything in it, as the freshest answer on the phone names it — the one
     * shown or any year kept (Р-9). Kept years keep the arrow bounded while another year loads, and
     * reachable when this one cannot be read — offline or the server failing (adversarial Ж, Ж′);
     * the freshest wins, so a year kept before its data was moved or removed never outranks what the
     * server says now (adversarial Л). Named by none — a newcomer, or nothing read yet — it is this
     * year: the arrow back went on to 2025, 2024… on an empty screen (adversarial Д).
     */
    const first = computed(() => {
      const shown = charts.value
      const at = fetchedAt.value
      const all = [...(shown && at ? [{ answer: shown, fetchedAt: at }] : []), ...kept.value]
      const freshest = all.reduce<(typeof all)[number] | null>(
        (best, one) => (best === null || one.fetchedAt > best.fetchedAt ? one : best),
        null,
      )
      return freshest?.answer.firstMonth?.slice(0, 4) ?? props.current
    })

    /** Whether a month runs is the phone's calendar's to say, not the answer's (review 3 of MOL-158). */
    const runningMonth = computed(() => today.value.slice(0, 7))
    const monthLabel = (month: string) =>
      month === runningMonth.value
        ? t('spending.charts.center_running', { month: longMonth(month, locale.value) })
        : longMonth(month, locale.value)
    /**
     * «+73 % к среднему», the running month «+2 % к обычному к 12 сентября» (owner's decision В-2) —
     * by the day the server compared to, a payment dated tomorrow included (adversarial В).
     */
    const changeWords = (month: string, change: number | null) => {
      if (change === null) return null
      const value = signedPercent(change, locale.value)
      return month === runningMonth.value
        ? t('spending.charts.year_change_running', {
            change: value,
            day: calendarDay(charts.value?.comparedTo ?? today.value, locale.value),
          })
        : t('spending.charts.year_change', { change: value })
    }

    /** The ring with its categories named as the month's are: the series carry them (Р-13). */
    const ring = computed(() => {
      const shown = charts.value
      if (!shown) return null
      const data: DonutData = {
        ...shown,
        categories: shown.categories.map((one) => one.category),
      }
      return data
    })
    /**
     * «нет курса за август»: which months keep the year's «≈» from being counted (review 14), as
     * «Пришло и ушло» names its own — read off the months, the phone counts nothing.
     */
    const noRate = computed(() => {
      const shown = charts.value
      // The server says why there is no «≈» (adversarial М′): a sum past money is no rate's fault,
      // and nothing is said under it.
      if (shown?.spentIncomeMissing !== 'rate') return shown?.spentIncomeMissing ? '' : null
      // The months the server names, not every month with no «≈»: one past money had a rate (М″).
      const missing = shown.rateMissing
      const [one] = missing
      if (!one) return null
      return missing.length === 1
        ? t('spending.charts.year_no_rate_one', { month: monthName(one, locale.value) })
        : t('spending.charts.year_no_rate_many', { n: missing.length }, missing.length)
    })
    const centreLabel = computed(() => {
      const n = charts.value?.monthsShown ?? 0
      return t('spending.charts.year_center', { year: props.year, n }, n)
    })

    const months = computed<MoneyChartYearView['months']>(() => charts.value?.months ?? [])
    const quiet = (month: YearMonth) => month.kind !== 'data'

    /**
     * The bar shown on arrival (Р-8): the running month in this year, else the last with a bar. A
     * choice of the person's stands while its bar has one; another year lets it go.
     */
    const arrival = computed(() => {
      const shown = months.value
      const running = shown.findIndex(
        (month) => month.month === runningMonth.value && !quiet(month),
      )
      if (running !== -1) return running
      return shown.findLastIndex((month) => !quiet(month))
    })
    function choice(barsOf: () => readonly { quiet?: boolean }[]): Ref<number> {
      const chosen = ref<number | null>(null)
      watch(
        () => props.year,
        () => {
          chosen.value = null
        },
      )
      return computed({
        get: () => {
          const at = chosen.value
          const bars = barsOf()
          return at !== null && bars[at] && !bars[at].quiet ? at : Math.max(0, arrival.value)
        },
        set: (index: number) => {
          chosen.value = index
        },
      })
    }

    const spentBars = computed<ChartBar[]>(() =>
      months.value.map((month) => ({
        key: month.month,
        label: shortMonth(month.month, locale.value),
        spoken: t('spending.charts.bar_label', {
          month: longMonth(month.month, locale.value),
          amount: whole(month.spent),
        }),
        level: month.spentLevel,
        quiet: quiet(month),
      })),
    )
    const spentAt = choice(() => spentBars.value)
    const spentMonth = computed(() => {
      const month = months.value[spentAt.value]
      return month && !quiet(month) ? month : null
    })
    const spentDetail = computed(() => {
      const month = spentMonth.value
      if (!month) return ''
      // No «≈ 0 ₽» over nothing counted, and what had no rate as written (MOL-184, adversarial Б1, Б2).
      const parts = [
        both.value && month.spentEstimated ? approx(month.spentIncome) : null,
        changeWords(month.month, month.change),
        month.uncounted.length > 0
          ? t('spending.charts.uncounted', { amounts: written(month.uncounted) })
          : null,
      ]
      return parts.filter((part) => part !== null).join(' · ')
    })
    /** Under the bars: what the dashed line is, or when it comes — or why it will not (Р-6). */
    const averageNote = computed(() => {
      const shown = charts.value
      if (!shown) return ''
      if (shown.average) {
        const span = monthSpan(shown.average.from, shown.average.to, locale.value)
        return t(shown.running ? 'spending.charts.year_avg_running' : 'spending.charts.year_avg', {
          amount: whole(shown.average.amount),
          ...span,
        })
      }
      if (shown.averageFrom) {
        return t('spending.charts.year_avg_few', {
          month: monthGenitive(previousMonth(shown.averageFrom), t),
        })
      }
      // Why, as the server says it: «3 из 3» said no to itself (adversarial Б), and a guess from the
      // count named a missing rate for a sum past money (adversarial З).
      if (shown.averageMissing === 'uncounted') return t('spending.charts.year_avg_uncounted')
      if (shown.averageMissing === 'beyond') return t('spending.charts.year_avg_beyond')
      return t('spending.charts.year_avg_short', { n: shown.closedCount })
    })

    const flowBars = computed<ChartBar[]>(() =>
      months.value.map((month) => ({
        key: month.month,
        label: shortMonth(month.month, locale.value),
        spoken: t('spending.charts.pair_label', {
          month: longMonth(month.month, locale.value),
          income: whole(month.income),
          spent: outOf(month),
        }),
        level: month.spentIncomeLevel,
        outline: month.incomeLevel,
        quiet: quiet(month),
      })),
    )
    const flowAt = choice(() => flowBars.value)
    const flowMonth = computed(() => {
      const month = months.value[flowAt.value]
      return month && !quiet(month) ? month : null
    })
    /** «Разница» of a month, or why there is none: no rate of the month, or something not counted. */
    const differenceOf = (month: YearMonth) =>
      month.difference
        ? month.spentEstimated || month.incomeEstimated
          ? signedApprox(month.difference)
          : signedAmount(month.difference, locale.value, { plus: true, estimate: true })
        : month.spentIncome === null
          ? t('spending.charts.no_rate')
          : t('spending.charts.difference_uncounted')
    /** What of the month did not convert, said under the figures it is missing from (adversarial d9 В). */
    const flowUncounted = computed(() => {
      const month = flowMonth.value
      if (!month) return []
      return [
        ...(month.incomeUncounted.length > 0
          ? [t('spending.charts.income_uncounted', { amounts: written(month.incomeUncounted) })]
          : []),
        ...(month.uncounted.length > 0
          ? [t('spending.charts.spent_uncounted', { amounts: written(month.uncounted) })]
          : []),
      ]
    })
    /** «За 2026 год разница ≈ +695 969 ₽», or which months keep it from being counted (Р-7). */
    const flowNote = computed(() => {
      const shown = charts.value
      const currency = t(`spending.charts.currency_in.${shown?.incomeCurrency ?? 'RUB'}`)
      if (shown?.differenceTotal) {
        // «≈» where a rate converted something of a month, as each month's «Разница» says it — not over
        // the exact drams of one who earns and spends in drams (MOL-184, adversarial Д1).
        const estimated = shown.months.some(
          (month) => month.spentEstimated || month.incomeEstimated,
        )
        const amount = signedAmount(shown.differenceTotal, locale.value, {
          plus: true,
          estimate: true,
        })
        return t('spending.charts.year_flow_note', {
          year: props.year,
          amount: estimated ? `≈ ${amount}` : amount,
          currency,
        })
      }
      if (shown && shown.differenceMissing.length > 0) {
        return t('spending.charts.year_flow_missing', {
          year: props.year,
          months: new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(
            shown.differenceMissing.map((month) => monthName(month, locale.value)),
          ),
          currency,
        })
      }
      return t('spending.charts.income_only', { currency })
    })

    const categoryOptions = computed(() =>
      (charts.value?.categories ?? []).map((one) => ({
        value: one.category.id,
        label: nameOf(one.category),
      })),
    )
    /**
     * The category asked for — in the address, else the last one chosen — or the year's largest. The
     * server offers every live category, spent in the year or not, so one asked for is drawn as its
     * months of nothing rather than swapped for another (adversarial А of MOL-74).
     */
    const series = computed(() => {
      const all = charts.value?.categories ?? []
      const wanted = typeof route.query.category === 'string' ? route.query.category : lastCategory
      return all.find((one) => one.category.id === wanted) ?? all[0] ?? null
    })
    /** The address names a category the charts do not have — a removed one, say: said, not hidden. */
    const categoryMissing = computed(() => {
      const wanted = route.query.category
      return (
        typeof wanted === 'string' && series.value !== null && series.value.category.id !== wanted
      )
    })
    /** The category this screen last asked the address for: the address answers a step later. */
    let asked: string | null = null
    function chooseCategory(id: string): void {
      lastCategory = id
      asked = id
      if (route.query.category === id) return
      void router.replace({ query: { ...route.query, category: id } })
    }
    watch(
      () => route.query.category,
      (id) => {
        if (typeof id === 'string') lastCategory = id
      },
      { immediate: true },
    )
    const categoryBars = computed<ChartBar[]>(() =>
      (series.value?.points ?? []).map((point, index) => ({
        key: point.month,
        label: shortMonth(point.month, locale.value),
        spoken: t('spending.charts.bar_label', {
          month: longMonth(point.month, locale.value),
          amount: whole(point.amount),
        }),
        level: point.level,
        quiet: months.value[index] ? quiet(months.value[index]) : true,
      })),
    )
    const categoryAt = choice(() => categoryBars.value)
    const categoryPoint = computed(() => {
      const bar = categoryBars.value[categoryAt.value]
      return bar && !bar.quiet ? (series.value?.points[categoryAt.value] ?? null) : null
    })
    const categoryDetail = computed(() => {
      const point = categoryPoint.value
      if (!point) return ''
      const average = series.value?.average
      return [
        changeWords(point.month, point.change),
        average ? t('spending.charts.category_average', { amount: whole(average) }) : null,
      ]
        .filter((part) => part !== null)
        .join(' · ')
    })

    // A sector chosen on the ring chooses its category below (owner's decision В-3); «Остальные»
    // is no one category, and letting a sector go leaves the category where it is.
    const sector = ref<string | null>(null)
    watch(sector, (key) => {
      if (key !== null && key !== 'rest' && key !== asked) chooseCategory(key)
    })
    /**
     * A category chosen in the list chooses its sector too, or lets the sector go when the ring has
     * none of its own (owner's decision Е of the review): the ring and the card say one thing, and a
     * tap on the sector shown never lets go of a category the card no longer shows.
     */
    function chooseFromList(id: string): void {
      chooseCategory(id)
      const own = charts.value?.slices.some((slice) => slice.categoryId === id) ?? false
      sector.value = own ? id : null
    }
    watch(
      () => props.year,
      () => {
        sector.value = null
      },
    )
    watch(charts, (shown) => {
      const keys = shown?.slices.map((slice) => slice.categoryId ?? 'rest') ?? []
      if (sector.value !== null && !keys.includes(sector.value)) sector.value = null
    })

    return {
      t,
      locale,
      id: useId(),
      IconDonut,
      phase,
      charts,
      stale,
      fetchedAt,
      attempt,
      retry,
      first,
      when,
      whole,
      approx,
      outOf,
      both,
      nameOf,
      ring,
      centreLabel,
      noRate,
      sector,
      monthLabel,
      shortMonth,
      categoryColour,
      spentBars,
      spentAt,
      spentMonth,
      spentDetail,
      averageNote,
      flowBars,
      flowAt,
      flowMonth,
      differenceOf,
      flowUncounted,
      flowNote,
      series,
      categoryOptions,
      categoryMissing,
      chooseCategory,
      chooseFromList,
      categoryBars,
      categoryAt,
      categoryPoint,
      categoryDetail,
    }
  },
})
</script>

<style scoped lang="scss">
/* Not `.card`: a scoped class of this component reaches the root of a child's too, and the root of
   `MonthSwitcher` is an `AppCard` — its pill was laid out as a grid of a chart's card. */
.chart-card {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-4);
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.legend {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.key {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-left: var(--space-2);
  border-radius: var(--radius-mark);

  /* The series as they stand unchosen: the accent is the month chosen, not a series (Р-7). */
  &.outline {
    box-shadow: inset 0 0 0 2px var(--graphic);
  }

  &.filled {
    background: var(--graphic);
  }
}

.month,
.detail,
.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.month {
  display: block;
  margin-top: var(--space-2);
}

.figure {
  @include display-type;

  display: block;
  margin: 0;
  font-size: var(--text-figure);
  font-variant-numeric: tabular-nums;

  &.small {
    font-size: var(--text-title);
  }
}

.hint {
  margin-top: var(--space-3);

  & + & {
    margin-top: var(--space-1);
  }

  /* The dashed line's own key, drawn as it is on the chart: told apart by its form (handoff 04). */
  &.dashed::before {
    display: inline-block;
    width: 1rem;
    margin-right: var(--space-2);
    border-top: 2px dashed var(--text);
    content: '';
    vertical-align: middle;
  }
}

.columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
  padding-top: var(--space-2);
}

.column {
  display: grid;
  margin: 0;
}

.label {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.value {
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  /* «нет курса месяца» is words, not a sum: in a third of the card it ran into the next column. */
  &.words {
    white-space: normal;
  }
}

.missing {
  margin-top: var(--space-2);
}

.category {
  width: 100%;
  margin-top: var(--space-3);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.split {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);

  p {
    margin: 0;
  }
}

.right {
  margin-top: var(--space-2);
  text-align: right;
}

/* The answer comes in where the skeleton stood, faded only: nothing under the thumb may move
   (MOL-151, review №5 and №7, MOL-138). Here and not on the screen: a component of several roots
   takes no scope of the screen's. */
.chart-card,
.answer {
  @include appear(0);
}
</style>
