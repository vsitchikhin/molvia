<template>
  <AppCard as="section" class="card" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`" class="caption">{{ t('spending.charts.vs_usual_title') }}</h2>
    <template v-if="charts.usual">
      <p class="note">{{ note }}</p>
      <ul v-if="rows.length > 0" class="rows">
        <li v-for="row in rows" :key="row.key" class="row">
          <span class="unseen">{{ row.spoken }}</span>
          <span class="head" aria-hidden="true">
            <span class="dot" :style="{ background: row.colour }"></span>
            <span class="name">{{ row.name }}</span>
            <span class="change">
              <IconUp v-if="row.direction === 'up'" class="arrow" />
              <IconDown v-else-if="row.direction === 'down'" class="arrow" />
              {{ row.change }}
            </span>
          </span>
          <span class="meta" aria-hidden="true">{{ row.meta }}</span>
          <span class="track" aria-hidden="true">
            <span class="fill" :style="{ width: row.width, background: row.colour }"></span>
            <span class="usual" :style="{ left: row.usualAt }"></span>
          </span>
        </li>
      </ul>
      <p v-if="rows.length > 0" class="note legend" aria-hidden="true">
        <span class="mark"></span>{{ t('spending.charts.vs_usual_legend') }}
      </p>
    </template>
    <div v-else class="few">
      <IconWait class="few-icon" aria-hidden="true" />
      <p class="few-text">
        <span class="few-title">{{ few.title }}</span>
        <span class="few-body">{{ few.body }}</span>
      </p>
    </div>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDown from '~icons/mdi/arrow-down'
import IconUp from '~icons/mdi/arrow-up'
import IconWait from '~icons/mdi/calendar-clock-outline'
import { CHART_LEVEL, currencySign, formatEstimate } from '@molvia/model'
import type { MoneyChartMonthView, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import {
  closedWords,
  longMonth,
  monthGenitive,
  monthSpan,
  signedPercent,
} from '@/components/charts'
import { categoryColour } from '@/components/spending'

/**
 * «Против обычного» of «Графики → Месяц» (MOL-158, handoff MOL-157 03): the categories that went
 * furthest from their usual month, as the server ordered them — the sum of the month a bar in the
 * category's colour, the usual a mark across it, the change an arrow and a number in the colour of
 * the text, never red or green: more is not worse here, only different. A category the usual never
 * had is «новая», not «+100 %»; one whose sum is not whole, in this month or every usual one, is no
 * row (adversarial Д). With fewer than three closed months the card stays and names the first month
 * that has a comparison and what was closed before this one — true of a past month as of the
 * running one (adversarial Г).
 */
export default defineComponent({
  name: 'DeviationBars',
  components: { AppCard, IconDown, IconUp, IconWait },
  props: {
    charts: { type: Object as PropType<MoneyChartMonthView>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
  },
  setup(props) {
    const { t, locale } = useI18n()
    const whole = (value: MoneyChartMonthView['spent']) => formatEstimate(value, locale.value)
    const percentOf = (level: number) => `${String((level * 100) / CHART_LEVEL)}%`

    const note = computed(() => {
      const usual = props.charts.usual
      if (!usual) return ''
      const { from, to } = monthSpan(usual.from, usual.to, locale.value)
      return t(
        props.charts.running
          ? 'spending.charts.vs_usual_note_running'
          : 'spending.charts.vs_usual_note',
        {
          month: longMonth(props.charts.month, locale.value).replace(/\s\S+$/, ''),
          from,
          to,
          sign: currencySign(props.charts.spendCurrency, locale.value),
        },
      )
    })

    const rows = computed(() =>
      props.charts.deviations.map((row) => {
        const category = props.charts.categories.find((one) => one.id === row.categoryId)
        const name = category ? props.nameOf(category) : ''
        const change =
          row.change === null
            ? t('spending.charts.vs_usual_new')
            : signedPercent(row.change, locale.value)
        const meta = t('spending.charts.vs_usual_meta', {
          amount: whole(row.amount),
          average: whole(row.average),
        })
        return {
          key: row.categoryId,
          name,
          colour: category ? categoryColour(category) : 'var(--border-strong)',
          change,
          direction:
            row.change === null || row.change === 0 ? null : row.change > 0 ? 'up' : 'down',
          meta,
          width: percentOf(row.level),
          usualAt: percentOf(row.averageLevel),
          spoken: t('spending.charts.vs_usual_spoken', {
            name,
            amount: whole(row.amount),
            average: whole(row.average),
            change,
          }),
        }
      }),
    )

    const few = computed(() => {
      const from = props.charts.comparedFrom
      return {
        title: from
          ? t('spending.charts.few_title', { month: monthGenitive(from, t) })
          : t('spending.charts.few_title_none'),
        body: closedWords(props.charts.month, props.charts.closed, locale.value, t),
      }
    })

    return { t, id: useId(), note, rows, few }
  },
})
</script>

<style scoped lang="scss">
.card {
  display: grid;
  gap: var(--space-2);
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

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.unseen {
  @include visually-hidden;
}

.rows {
  display: grid;
  gap: var(--space-4);
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.row {
  display: grid;
  gap: var(--space-1);
}

.head {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.dot {
  flex: none;
  width: 0.625rem;
  height: 0.625rem;
  border-radius: 50%;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.arrow {
  width: 1.125rem;
  height: 1.125rem;
}

.meta {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
}

.track {
  position: relative;
  display: flex;
  align-items: center;
  height: 0.625rem;
  margin-top: var(--space-1);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
}

.fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
}

/* The usual month: a mark across the track, in the ink of the text — seen without its colour. */
.usual {
  position: absolute;
  width: 3px;
  height: 1.125rem;
  border-radius: var(--radius-mark);
  background: var(--text);
  transform: translateX(-50%);
}

.legend {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.mark {
  width: 3px;
  height: 0.875rem;
  border-radius: var(--radius-mark);
  background: var(--text);
}

.few {
  display: flex;
  gap: var(--space-3);
  align-items: flex-start;
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.few-icon {
  flex: none;
  width: 1.375rem;
  height: 1.375rem;
  color: var(--text-muted);
}

.few-text {
  display: grid;
  gap: var(--space-1);
  margin: 0;
}

.few-title {
  font-size: var(--text-callout);
  font-weight: var(--weight-bold);
}

.few-body {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
