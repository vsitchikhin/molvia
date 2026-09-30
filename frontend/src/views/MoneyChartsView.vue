<template>
  <AppScreen :title="t('spending.charts.title')">
    <!-- The line stands in every state, empty until a range is known: gone under the skeleton, it
         took the period below it up by its height, and back with the answer, down (MOL-138). An
         error or «offline» with nothing read keeps it empty rather than move the period again. -->
    <template #subtitle
      ><span class="range">{{ range }}</span></template
    >

    <div class="content">
      <SegmentedControl
        :model-value="String(period)"
        :options="periods"
        :legend="t('spending.charts.period')"
        hide-legend
        @update:model-value="choosePeriod"
      />

      <!-- Under the period: they are about the charts of the one chosen, and over it they came
           and went with its answer and took it from under the thumb (MOL-138, owner's В-2). -->
      <p v-if="stale === 'offline' && fetchedAt" class="strip">
        <IconCloudOff class="strip-icon" aria-hidden="true" />
        {{ t('spending.charts.offline.strip', { when: when(fetchedAt) }) }}
      </p>
      <ScreenState
        v-else-if="stale === 'error'"
        kind="error"
        inline
        :title="t('spending.charts.load_error.title')"
        :body="t('spending.charts.load_error.body')"
        @retry="retry"
      />

      <ScreenSkeleton v-if="phase === 'loading'" :groups="[40, 28, 90, 40, 28, 90, 40, 28, 70]" />

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
          v-if="charts.since === null"
          kind="empty"
          tone="accent"
          :icon="IconChart"
          :title="t('spending.charts.empty.title')"
          :body="t('spending.charts.empty.body')"
        />

        <template v-else>
          <AppCard as="section" class="card" :aria-labelledby="`${id}-spent`">
            <h2 :id="`${id}-spent`" class="caption">{{ t('spending.charts.spent_title') }}</h2>
            <BarChart
              v-model="spentAt"
              :bars="spentBars"
              :legend="t('spending.charts.spent_title')"
            >
              <template v-if="spentMonth">
                <p class="month">{{ longMonth(spentMonth.month, locale) }}</p>
                <p class="figure">{{ whole(spentMonth.spent) }}</p>
                <p class="detail">{{ spentDetail }}</p>
              </template>
            </BarChart>
            <p class="hint">{{ t('spending.charts.spent_hint') }}</p>
          </AppCard>

          <AppCard as="section" class="card" :aria-labelledby="`${id}-flow`">
            <div class="head">
              <h2 :id="`${id}-flow`" class="caption">{{ t('spending.charts.income_title') }}</h2>
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
                    <span class="value">{{ approx(flowMonth.spentIncome) }}</span>
                  </p>
                  <p class="column">
                    <span class="label">
                      {{
                        t('spending.charts.difference', {
                          month: shortMonth(flowMonth.month, locale),
                        })
                      }}
                    </span>
                    <span
                      class="value"
                      :class="{ negative: (flowMonth.difference?.minor ?? 0n) < 0n }"
                    >
                      {{ differenceOf(flowMonth) }}
                    </span>
                  </p>
                </div>
                <p v-for="line in flowUncounted" :key="line" class="detail">{{ line }}</p>
              </template>
            </BarChart>
            <p class="hint">{{ flowNote }}</p>
          </AppCard>

          <AppCard v-if="series" as="section" class="card" :aria-labelledby="`${id}-category`">
            <h2 :id="`${id}-category`" class="caption">
              {{ t('spending.charts.category_title') }}
            </h2>
            <AppField
              :model-value="series.category.id"
              kind="select"
              :label="t('spending.sheet.category')"
              :options="categoryOptions"
              hide-label
              class="category"
              @update:model-value="chooseCategory"
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
              :legend="t('spending.charts.category_title')"
              :colour="categoryColour(series.category)"
              :average="series.averageLevel"
              short
            >
              <div v-if="categoryPoint" class="split">
                <p>
                  <span class="month">{{ longMonth(categoryPoint.month, locale) }}</span>
                  <span class="figure small">{{ whole(categoryPoint.amount) }}</span>
                </p>
                <p class="detail right">{{ categoryDetail }}</p>
              </div>
            </BarChart>
            <p class="hint">{{ t('spending.charts.category_hint') }}</p>
          </AppCard>
        </template>

        <!-- The rate and the exchanges stand without spendings too: the first thing an emigrant
             does is change money (adversarial В). -->
        <AppCard v-if="rate" as="section" class="card" :aria-labelledby="`${id}-rate`">
          <h2 :id="`${id}-rate`" class="caption">{{ rateTitle }}</h2>
          <RateLine
            v-model="rateAt"
            :points="ratePoints"
            :marks="rateMarks"
            :legend="rateTitle"
            :first="rateEnds.first"
            :last="rateEnds.last"
          >
            <template v-if="ratePoint">
              <p class="month">
                {{ t('spending.charts.rate_week', { day: day(ratePoint.day) }) }}
              </p>
              <p class="figure small">
                {{
                  ratePoint.rate
                    ? rateWords(ratePoint.rate, locale, t)
                    : t('spending.charts.rate_none')
                }}
              </p>
              <p v-for="mine in rateMine" :key="mine" class="detail">{{ mine }}</p>
            </template>
          </RateLine>
          <p class="hint">{{ t('spending.charts.rate_hint') }}</p>
        </AppCard>
        <ExchangeLosses v-if="charts.exchanges" :losses="charts.exchanges" />
      </template>
    </div>
  </AppScreen>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import IconChart from '~icons/mdi/chart-bar'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import { currencySign, formatEstimate } from '@molvia/model'
import type { Money, MoneyChartsView, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import AppScreen from '@/components/AppScreen.vue'
import BarChart from '@/components/BarChart.vue'
import type { ChartBar } from '@/components/BarChart.vue'
import ExchangeLosses from '@/components/ExchangeLosses.vue'
import RateLine from '@/components/RateLine.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { countedWhen, signedAmount } from '@/components/accounts'
import { longMonth, shortMonth, versusPrevious } from '@/components/charts'
import { categoryColour, rateWords } from '@/components/spending'
import { useMoneyCharts } from '@/composables/useMoneyCharts'
import { calendarDay, monthOf } from '@/days'

/**
 * The category last chosen, for as long as the app is open (handoff 03, «в памяти вкладки»), for a
 * way in that names none — the card of «Куда ушли» with no ring: an empty month, a month kept before
 * the ring, one nothing was counted in by a rate. A category in the
 * address comes first: the ring names its largest, the one just seen (MOL-156, owner's decision on
 * adversarial round 2, Д), and so a tap on it leaves the one chosen here behind.
 */
let lastCategory: string | null = null

/**
 * «Графики» (MOL-74, handoff 03): the months of the period side by side — spending, what came in and
 * went out, a category over time — the rate of the pair by week, and the exchanges against the
 * central bank. Every figure and every height is the server's; the screen chooses a bar and words.
 * The period and the category are in the address and move by `replace`.
 */
export default defineComponent({
  name: 'MoneyChartsView',
  components: {
    AppCard,
    AppField,
    AppScreen,
    BarChart,
    ExchangeLosses,
    IconCloudOff,
    RateLine,
    ScreenSkeleton,
    ScreenState,
    SegmentedControl,
  },
  setup() {
    const { t, locale } = useI18n()
    const route = useRoute()
    const router = useRouter()

    const period = computed<6 | 12>(() => (route.query.period === '12' ? 12 : 6))
    const { phase, charts, stale, fetchedAt, retry } = useMoneyCharts(period)

    const periods = computed(() => [
      { value: '6', label: t('spending.charts.period_6') },
      { value: '12', label: t('spending.charts.period_12') },
    ])
    function choosePeriod(value: string): void {
      void router.replace({ query: { ...route.query, period: value === '12' ? '12' : undefined } })
    }

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const approx = (value: Money | null) =>
      value ? `≈ ${whole(value)}` : t('spending.charts.no_rate')
    const signedApprox = (value: Money) =>
      `≈ ${signedAmount(value, locale.value, { plus: true, estimate: true })}`
    /** «Разница» of a month, or why there is none: no rate of the month, or something not counted. */
    const differenceOf = (month: MoneyChartsView['months'][number]) =>
      month.difference
        ? signedApprox(month.difference)
        : month.spentIncome === null
          ? t('spending.charts.no_rate')
          : t('spending.charts.difference_uncounted')
    const when = (at: Date) => countedWhen(at, locale.value)
    const day = (value: string) => calendarDay(value, locale.value)

    const range = computed(() => {
      const months = charts.value?.months
      const first = months?.[0]?.month
      const last = months?.at(-1)?.month
      if (!first || !last) return null
      const from =
        first.slice(0, 4) === last.slice(0, 4)
          ? longMonth(first, locale.value).replace(/\s\S+$/, '')
          : longMonth(first, locale.value)
      return t('spending.charts.range', { from, to: monthOf(last, locale.value) })
    })

    const months = computed<MoneyChartsView['months']>(() => charts.value?.months ?? [])
    const lastIndex = computed(() => Math.max(0, months.value.length - 1))

    // Each chart keeps its own choice; a new period starts every one on its last month.
    const spentAt = ref(0)
    const flowAt = ref(0)
    const categoryAt = ref(0)
    const rateAt = ref(0)
    // Sources apart, compared one by one: a getter of an array is a new array on every answer, and
    // every answer — a write landed, the connection back — threw the choice to the last month (review).
    watch(
      [() => charts.value?.period, lastIndex, () => charts.value?.rate?.points.length],
      () => {
        spentAt.value = lastIndex.value
        flowAt.value = lastIndex.value
        categoryAt.value = lastIndex.value
        rateAt.value = Math.max(0, (charts.value?.rate?.points.length ?? 1) - 1)
      },
      { immediate: true },
    )

    const spentBars = computed<ChartBar[]>(() =>
      months.value.map((month) => ({
        key: month.month,
        label: shortMonth(month.month, locale.value),
        spoken: t('spending.charts.bar_label', {
          month: longMonth(month.month, locale.value),
          amount: whole(month.spent),
        }),
        level: month.spentLevel,
      })),
    )
    const spentMonth = computed(() => months.value[spentAt.value] ?? null)
    const spentDetail = computed(() => {
      const month = spentMonth.value
      if (!month) return ''
      const parts = [
        charts.value?.incomeCurrency === charts.value?.spendCurrency
          ? null
          : approx(month.spentIncome),
        versusPrevious(month.change, month.month, locale.value, t),
        month.uncounted.length > 0
          ? t('spending.charts.uncounted', {
              amounts: month.uncounted.map((amount) => whole(amount)).join(', '),
            })
          : null,
      ]
      return parts.filter((part) => part !== null).join(' · ')
    })

    const flowBars = computed<ChartBar[]>(() =>
      months.value.map((month) => ({
        key: month.month,
        label: shortMonth(month.month, locale.value),
        spoken: t('spending.charts.pair_label', {
          month: longMonth(month.month, locale.value),
          income: whole(month.income),
          spent: approx(month.spentIncome),
        }),
        level: month.spentIncomeLevel,
        outline: month.incomeLevel,
      })),
    )
    const flowMonth = computed(() => months.value[flowAt.value] ?? null)
    /** What of the month did not convert, said under the figures it is missing from (adversarial d9 В). */
    const flowUncounted = computed(() => {
      const month = flowMonth.value
      if (!month) return []
      const list = (amounts: readonly Money[]) => amounts.map((amount) => whole(amount)).join(', ')
      return [
        ...(month.incomeUncounted.length > 0
          ? [t('spending.charts.income_uncounted', { amounts: list(month.incomeUncounted) })]
          : []),
        ...(month.uncounted.length > 0
          ? [t('spending.charts.spent_uncounted', { amounts: list(month.uncounted) })]
          : []),
      ]
    })
    const flowNote = computed(() => {
      const currency = charts.value?.incomeCurrency ?? 'RUB'
      const words = t(`spending.charts.currency_in.${currency}`)
      const average = charts.value?.differenceAverage
      return average
        ? t('spending.charts.income_note', {
            amount: signedApprox(average),
            currency: words,
          })
        : t('spending.charts.income_only', { currency: words })
    })

    function nameOf(category: SpendingCategoryView): string {
      return category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
    }
    const categoryOptions = computed(() =>
      (charts.value?.categories ?? []).map((one) => ({
        value: one.category.id,
        label: nameOf(one.category),
      })),
    )
    /**
     * The category asked for — in the address, else the last one chosen — or the largest. The server
     * offers every category of the owner, spent in the period or not, so one tapped on an older month
     * is drawn as its months of nothing rather than swapped for another (adversarial А); only a choice
     * of the person's, or the address, is remembered.
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
    function chooseCategory(id: string): void {
      lastCategory = id
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
      (series.value?.points ?? []).map((point) => ({
        key: point.month,
        label: shortMonth(point.month, locale.value),
        spoken: t('spending.charts.bar_label', {
          month: longMonth(point.month, locale.value),
          amount: whole(point.amount),
        }),
        level: point.level,
      })),
    )
    const categoryPoint = computed(() => series.value?.points[categoryAt.value] ?? null)
    const categoryDetail = computed(() => {
      const point = categoryPoint.value
      if (!point) return ''
      const change =
        versusPrevious(point.change, point.month, locale.value, t) ??
        t('spending.charts.category_no_previous')
      const average = series.value?.average
      return average
        ? `${change} · ${t('spending.charts.category_average', { amount: whole(average) })}`
        : change
    })

    const rate = computed(() => charts.value?.rate ?? null)
    const rateTitle = computed(() => {
      const known = rate.value?.points.find((point) => point.rate !== null)?.rate
      const mark = rate.value?.exchanges[0]?.rate
      const any = known ?? mark
      if (!any) return ''
      return t('spending.charts.rate_title', {
        one: currencySign(any.base, locale.value),
        other: currencySign(any.quote, locale.value),
      })
    })
    const ratePoints = computed(() =>
      (rate.value?.points ?? []).map((point) => ({
        level: point.level,
        spoken: t('spending.charts.rate_spoken', {
          day: day(point.day),
          rate: point.rate
            ? rateWords(point.rate, locale.value, t)
            : t('spending.charts.rate_none'),
        }),
      })),
    )
    const rateMarks = computed(() =>
      (rate.value?.exchanges ?? []).map(({ week, level }) => ({ week, level })),
    )
    const ratePoint = computed(() => rate.value?.points[rateAt.value] ?? null)
    const rateMine = computed(() =>
      (rate.value?.exchanges ?? [])
        .filter((exchange) => exchange.week === rateAt.value)
        .map((exchange) =>
          t('spending.charts.rate_mine', {
            day: day(exchange.day),
            rate: rateWords(exchange.rate, locale.value, t),
          }),
        ),
    )
    const rateEnds = computed(() => {
      const points = rate.value?.points ?? []
      const short = (value: string | undefined) =>
        value ? calendarDay(value, locale.value, { day: 'numeric', month: 'short' }) : ''
      return { first: short(points[0]?.day), last: short(points.at(-1)?.day) }
    })

    return {
      t,
      locale,
      id: useId(),
      IconChart,
      phase,
      charts,
      stale,
      fetchedAt,
      retry,
      period,
      periods,
      choosePeriod,
      range,
      when,
      day,
      whole,
      approx,
      differenceOf,
      flowUncounted,
      longMonth,
      shortMonth,
      categoryColour,
      rateWords,
      spentAt,
      flowAt,
      categoryAt,
      rateAt,
      spentBars,
      spentMonth,
      spentDetail,
      flowBars,
      flowMonth,
      flowNote,
      series,
      categoryOptions,
      chooseCategory,
      categoryMissing,
      nameOf,
      categoryBars,
      categoryPoint,
      categoryDetail,
      rate,
      rateTitle,
      ratePoints,
      rateMarks,
      ratePoint,
      rateMine,
      rateEnds,
    }
  },
})
</script>

<style scoped lang="scss">
.range {
  display: block;
  min-height: 1lh;
}

.content {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-3);
  padding: var(--space-4);
}

.strip {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--warn-tint);
  color: var(--warn-ink);
  font-size: var(--text-footnote);
}

.strip-icon {
  flex: none;
  width: 1.125rem;
  height: 1.125rem;
}

.card {
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
  border-radius: 2px;

  &.outline {
    box-shadow: inset 0 0 0 2px var(--text-muted);
  }

  &.filled {
    background: var(--accent);
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
  display: block;
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-figure);
  font-weight: 800;
  font-variant-numeric: tabular-nums;

  &.small {
    font-size: var(--text-title);
  }
}

.hint {
  margin-top: var(--space-3);
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

  &.negative {
    color: var(--bad-ink);
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
</style>
