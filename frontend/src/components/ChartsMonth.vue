<template>
  <!-- Under the switchers: they are about the month chosen, and over them they came and went with
       its answer and took it from under the thumb (MOL-138, owner's В-2). -->
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

  <ScreenSkeleton v-if="phase === 'loading'" :groups="[28, 100, 62, 70, 54, 34, 80, 66]" />

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
      v-if="empty"
      kind="empty"
      tone="accent"
      :icon="IconDonut"
      :title="t('spending.charts.empty.title')"
      :body="t('spending.charts.empty.body')"
    />
    <template v-else>
      <DonutChart v-model="sector" :charts="charts" :name-of="nameOf" />
      <DeviationBars :charts="charts" :name-of="nameOf" />
      <AppCard as="section" class="card" :aria-labelledby="`${id}-pace`">
        <div class="head">
          <h2 :id="`${id}-pace`" class="caption">{{ t('spending.charts.pace_title') }}</h2>
          <p class="legend" aria-hidden="true">
            <span class="key solid"></span>{{ monthWord }}
            <template v-if="charts.pace.usual">
              <span class="key dashed"></span>{{ t('spending.charts.pace_usual') }}
            </template>
          </p>
        </div>
        <PaceLine
          v-model="dayAt"
          :days="paceDays"
          :usual="paceUsual"
          :length="length"
          :legend="t('spending.charts.pace_title')"
        >
          <template v-if="reading">
            <p class="month">{{ reading.label }}</p>
            <p class="figure">{{ reading.figure }}</p>
            <p v-if="reading.sub" class="detail">{{ reading.sub }}</p>
          </template>
        </PaceLine>
        <p class="hint">{{ paceNote }}</p>
      </AppCard>
    </template>
  </template>
</template>

<script lang="ts">
import { computed, defineComponent, ref, toRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDonut from '~icons/mdi/chart-donut'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import { formatEstimate, lastDayOf, percentChange } from '@molvia/model'
import type { Money, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import DeviationBars from '@/components/DeviationBars.vue'
import DonutChart from '@/components/DonutChart.vue'
import PaceLine from '@/components/PaceLine.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import { countedWhen } from '@/components/accounts'
import { longMonth, monthAfter, signedPercent } from '@/components/charts'
import { useMoneyChartMonth } from '@/composables/useMoneyCharts'
import { calendarDay, localDay } from '@/days'

/**
 * «Графики → Месяц» (MOL-158, handoff MOL-157 03): where the month went, what went past the usual
 * month and how fast it is being spent. Every figure and height is the server's
 * (`GET /money/months/:month/charts`); the screen chooses a sector and a day, neither of which goes
 * into the address (handoff 06): a new month lets the sector go and puts the day on today, or on
 * the month's last (Р-7, Р-9).
 */
export default defineComponent({
  name: 'ChartsMonth',
  components: {
    AppCard,
    DeviationBars,
    DonutChart,
    IconCloudOff,
    PaceLine,
    ScreenSkeleton,
    ScreenState,
  },
  props: {
    month: { type: String, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const { phase, charts, stale, fetchedAt, retry } = useMoneyChartMonth(toRef(props, 'month'))

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const when = (at: Date) => countedWhen(at, locale.value)
    const nameOf = (category: SpendingCategoryView) =>
      category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')

    /** No month with anything in it, before or now: an offer, not an empty ring (handoff 5b). */
    const empty = computed(() => {
      const shown = charts.value
      return (
        shown !== null &&
        shown.spent.minor === 0n &&
        shown.uncounted.length === 0 &&
        shown.closed.length === 0
      )
    })

    const sector = ref<string | null>(null)
    const dayAt = ref(0)
    /** Today in a running month — or the last day drawn, if that is sooner; else the last day. */
    function dayOnArrival(): number {
      const days = charts.value?.pace.days ?? []
      const last = Math.max(0, days.length - 1)
      if (!charts.value?.running) return last
      return Math.min(last, Math.max(0, Number(localDay().slice(8, 10)) - 1))
    }
    // Sources apart, compared one by one: a new answer of the same month — a write landed — keeps
    // the choice; another month lets it go (review of MOL-74).
    watch(
      [() => charts.value?.month, () => charts.value?.pace.days.length],
      ([month], [before]) => {
        if (month !== before) sector.value = null
        dayAt.value = dayOnArrival()
      },
      { immediate: true },
    )

    const length = computed(() => Number(lastDayOf(props.month).slice(8, 10)))
    const monthWord = computed(() => longMonth(props.month, locale.value).replace(/\s\S+$/, ''))
    const paceDays = computed(() => {
      const shown = charts.value
      if (!shown) return []
      return shown.pace.days.map((day, index) => {
        const usual = shown.pace.usual?.[index]
        const date = calendarDay(day.day, locale.value)
        return {
          level: day.level,
          spoken: usual
            ? t('spending.charts.pace_spoken', {
                date,
                amount: whole(day.cumulative),
                average: whole(usual.cumulative),
              })
            : t('spending.charts.pace_spoken_few', { date, amount: whole(day.cumulative) }),
        }
      })
    })
    const paceUsual = computed(() => charts.value?.pace.usual?.map((point) => point.level) ?? null)

    const reading = computed(() => {
      const shown = charts.value
      const day = shown?.pace.days[dayAt.value]
      if (!shown || !day) return null
      const date = calendarDay(day.day, locale.value)
      const label =
        shown.running && day.day === localDay()
          ? t('spending.charts.pace_today', { date })
          : t('spending.charts.pace_day', { date })
      const usual = shown.pace.usual?.[dayAt.value]
      const both = shown.spendCurrency !== shown.incomeCurrency
      let sub: string | null = null
      if (usual) {
        const change = percentChange(day.cumulative, usual.cumulative)
        sub =
          change === null
            ? t('spending.charts.pace_sub_plain', { amount: whole(usual.cumulative) })
            : t('spending.charts.pace_sub', {
                amount: whole(usual.cumulative),
                change: signedPercent(change, locale.value),
              })
      } else if (both) {
        sub = day.income ? `≈ ${whole(day.income)}` : t('spending.charts.no_rate')
      }
      return { label, figure: whole(day.cumulative), sub }
    })
    const paceNote = computed(() =>
      charts.value?.pace.usual
        ? t('spending.charts.pace_note')
        : t('spending.charts.pace_few', {
            month: monthAfter(charts.value?.usualFrom ?? props.month, t),
          }),
    )

    return {
      t,
      id: useId(),
      IconDonut,
      phase,
      charts,
      stale,
      fetchedAt,
      retry,
      when,
      nameOf,
      empty,
      sector,
      dayAt,
      length,
      monthWord,
      paceDays,
      paceUsual,
      reading,
      paceNote,
    }
  },
})
</script>

<style scoped lang="scss">
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

/* The two series are told apart by their stroke, not their colour alone (handoff 03). */
.key {
  display: inline-block;
  width: 1rem;
  margin-left: var(--space-2);

  &.solid {
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
  }

  &.dashed {
    border-top: 2px dashed var(--text-muted);
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
  margin-top: var(--space-2);
}

.figure {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-title);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.hint {
  margin-top: var(--space-3);
}
</style>
