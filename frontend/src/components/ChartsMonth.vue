<template>
  <!-- Under the switchers: they are about the month chosen, and over them they came and went with
       its answer and took it from under the thumb (MOL-138, owner's В-2). -->
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

  <ChartsSkeleton v-if="phase === 'loading'" class="spaced" />

  <ScreenState
    v-else-if="phase === 'error'"
    class="spaced"
    kind="error"
    :title="t('spending.charts.load_error.title')"
    :body="t('spending.charts.load_error.body')"
    @retry="retry"
  />

  <ScreenState
    v-else-if="phase === 'offline'"
    class="spaced"
    kind="offline"
    tone="warn"
    :title="t('spending.offline.title')"
    :body="t('spending.charts.offline.body')"
  />

  <template v-else-if="charts">
    <ScreenState
      v-if="empty"
      class="spaced"
      kind="empty"
      :icon="IconDonut"
      :title="t('spending.charts.empty.title')"
      :body="t('spending.charts.empty.body')"
    />
    <template v-else>
      <DonutChart
        v-model="sector"
        class="answer"
        :charts="onScreen ?? charts"
        :label="centreLabel"
        :name-of="nameOf"
      />
      <DeviationBars class="answer" :charts="onScreen ?? charts" :name-of="nameOf" />
      <AppCard as="section" class="card" :aria-labelledby="`${id}-pace`">
        <div class="head">
          <SectionCaption :id="`${id}-pace`" inset>{{
            t('spending.charts.pace_title')
          }}</SectionCaption>
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
import { formatEstimate, lastDayOf, percentChange } from '@molvia/model'
import type { Money, SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import ChartsSkeleton from '@/components/ChartsSkeleton.vue'
import DeviationBars from '@/components/DeviationBars.vue'
import DonutChart from '@/components/DonutChart.vue'
import PaceLine from '@/components/PaceLine.vue'
import ScreenState from '@/components/ScreenState.vue'
import { countedWhen } from '@/components/accounts'
import { longMonth, monthGenitive, signedPercent } from '@/components/charts'
import SectionCaption from '@/components/SectionCaption.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import { useMoneyChartMonth } from '@/composables/useMoneyCharts'
import { useLocalDay } from '@/composables/useLocalDay'
import { calendarDay } from '@/days'

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
    AppButton,
    AppCard,
    ChartsSkeleton,
    DeviationBars,
    DonutChart,
    PaceLine,
    ScreenState,
    SectionCaption,
    StatusStrip,
  },
  props: {
    month: { type: String, required: true },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const { phase, charts, stale, fetchedAt, attempt, retry } = useMoneyChartMonth(
      toRef(props, 'month'),
    )
    const today = useLocalDay()
    /**
     * The answer as the screen says it: whether the month runs is the phone's calendar's to say, not
     * the answer's — one kept from September 30th, opened offline on October 1st, said «Сентябрь ·
     * идёт» over a pace already on the 30th (review 3). Every word of «идёт», «на сегодня» and
     * «сегодня» reads this one.
     */
    const onScreen = computed(() =>
      charts.value === null
        ? null
        : { ...charts.value, running: charts.value.month === today.value.slice(0, 7) },
    )

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const when = (at: Date) => countedWhen(at, locale.value)
    const nameOf = (category: SpendingCategoryView) =>
      category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')

    /**
     * No month with anything in it, ever: an offer, not an empty ring (handoff 5b). A month before
     * the first with data is a grey ring of a person who has data (adversarial К).
     */
    const empty = computed(() => charts.value !== null && charts.value.firstMonth === null)

    const sector = ref<string | null>(null)
    const arrival = ref(0)
    /** The day the person chose in this visit of this month; null — none, the day of arrival stands. */
    const chosenDay = ref<number | null>(null)
    /**
     * Today in this phone's month — or the last day drawn, if that is sooner; else the last day
     * (Р-7). Whether the month runs is the phone's calendar's to say, not the answer's: an answer
     * kept from when September ran says so on the 1st of October (adversarial round 2, Н2).
     */
    function dayOnArrival(): number {
      const days = charts.value?.pace.days ?? []
      const last = Math.max(0, days.length - 1)
      if (!onScreen.value?.running) return last
      return Math.min(last, Math.max(0, Number(today.value.slice(8, 10)) - 1))
    }
    /**
     * The day shown: the one the person chose while the line still reaches it (adversarial З), else
     * the day of arrival of the answer on screen — worked out again for every answer, so the day of
     * an answer kept from yesterday is never taken for a choice (adversarial round 2, Н1).
     */
    const dayAt = computed({
      get: () => chosenDay.value ?? arrival.value,
      set: (day: number) => {
        chosenDay.value = day
      },
    })
    // Another month lets the choices go; a new answer of the same month — a write landed — keeps
    // them (Р-9): the sector while the ring still has it — gone into «Остальные», it dimmed the whole
    // ring with nothing chosen (adversarial А).
    watch(
      () => charts.value?.month,
      () => {
        sector.value = null
        chosenDay.value = null
      },
      { immediate: true },
    )
    watch(
      [() => charts.value, today],
      ([shown]) => {
        arrival.value = dayOnArrival()
        if (!shown) return
        const keys = shown.slices.map((slice) => slice.categoryId ?? 'rest')
        if (sector.value !== null && !keys.includes(sector.value)) sector.value = null
        const last = shown.pace.days.length - 1
        if (chosenDay.value !== null && chosenDay.value > last) chosenDay.value = null
      },
      { immediate: true },
    )

    const length = computed(() => Number(lastDayOf(props.month).slice(8, 10)))
    const monthWord = computed(() => longMonth(props.month, locale.value).replace(/\s\S+$/, ''))
    const centreLabel = computed(() =>
      onScreen.value?.running
        ? t('spending.charts.center_running', { month: monthWord.value })
        : monthWord.value,
    )
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
        onScreen.value?.running && day.day === today.value
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
    /**
     * Under the pace: what the dashed line is, or why there is none — too few closed months, named by
     * the first month that has it, or months enough and none of them whole (adversarial И): never «it
     * comes» of a usual the card above already compares with.
     */
    const paceNote = computed(() => {
      const shown = charts.value
      const line = shown?.pace.usual
        ? t('spending.charts.pace_note')
        : shown?.usual
          ? t('spending.charts.pace_uncounted')
          : shown?.comparedFrom
            ? t('spending.charts.pace_few', { month: monthGenitive(shown.comparedFrom, t) })
            : t('spending.charts.pace_few_none')
      // «Ведите ползунок» only over a slider: the 1st of a running month has one day and none
      // (adversarial А6).
      return (shown?.pace.days.length ?? 0) > 1 ? `${line} ${t('spending.charts.pace_move')}` : line
    })

    return {
      t,
      id: useId(),
      IconDonut,
      phase,
      charts,
      onScreen,
      stale,
      fetchedAt,
      attempt,
      retry,
      when,
      nameOf,
      empty,
      sector,
      dayAt,
      length,
      monthWord,
      centreLabel,
      paceDays,
      paceUsual,
      reading,
      paceNote,
    }
  },
})
</script>

<style scoped lang="scss">
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

.legend {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

/* The two series are told apart by their stroke, not their colour alone (handoff 03); both are data,
   so neither is the accent (Ф-4, MOL-186). */
.key {
  display: inline-block;
  width: 1rem;
  margin-left: var(--space-2);

  &.solid {
    height: 3px;
    border-radius: var(--radius-mark);
    background: var(--text);
  }

  &.dashed {
    border-top: 2px dashed var(--graphic);
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
  @include display-type;

  margin: 0;
  font-size: var(--text-title);
  font-variant-numeric: tabular-nums;
}

.hint {
  margin-top: var(--space-3);
}

/* What stands in the answer's place — the skeleton, a state — stands where its first card would. */
.spaced {
  margin-top: var(--space-4);
}

/* The answer comes in where the skeleton stood, faded only: nothing under the thumb may move
   (MOL-151, review №5 and №7, MOL-138). Here and not on the screen: a component of several roots
   takes no scope of the screen's. 24 between the cards and above the first, with the screen's 8
   (Ф-10). */
.card,
.answer {
  @include appear(0);

  margin-top: var(--space-4);
}
</style>
