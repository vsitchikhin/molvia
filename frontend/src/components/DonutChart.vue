<template>
  <AppCard as="section" class="card" :aria-labelledby="`${id}-title`">
    <SectionCaption :id="`${id}-title`" inset>{{ heading }}</SectionCaption>
    <div class="figure">
      <!-- A tap on the ring chooses the sector under it; the legend's radios say the same. -->
      <div ref="ringBox" class="ring-box" @click="tapRing">
        <DonutRing class="ring" :sectors="sectors" :thickness="THICKNESS" :chosen="modelValue" />
      </div>
      <!-- Not a live region (review Р-6): the radio chosen already says it. -->
      <p class="center">
        <span class="center-label">{{ centre.label }}</span>
        <span class="center-figure">{{ centre.figure }}</span>
        <span v-if="centre.sub" class="center-sub">{{ centre.sub }}</span>
      </p>
    </div>
    <fieldset v-if="rows.length > 0" class="legend">
      <legend class="unseen">{{ heading }}</legend>
      <label
        v-for="row in rows"
        :key="row.key"
        class="row"
        :class="{ chosen: row.key === modelValue }"
      >
        <input
          type="radio"
          class="radio"
          :name="id"
          :value="row.key"
          :checked="row.key === modelValue"
          @click="toggle(row.key)"
          @change="choose(row.key)"
        />
        <span class="dot" :style="{ background: row.colour }"></span>
        <span class="name">{{ row.name }}</span>
        <span class="amount">{{ row.amount }}</span>
        <span class="share">{{ row.share }}</span>
      </label>
    </fieldset>
    <p v-if="uncounted" class="note">{{ uncounted }}</p>
    <p v-if="restNames" class="note">{{ restNames }}</p>
    <p v-if="rows.length > 1" class="note">{{ t('spending.charts.donut_order') }}</p>
    <p v-if="note" class="note">{{ note }}</p>
  </AppCard>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { CHART_LEVEL, formatEstimate, shareOf } from '@molvia/model'
import type { Currency, Money, MoneyChartMonthView, SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import DonutRing, { CHOSEN_THICKER } from '@/components/DonutRing.vue'
import type { RingSector } from '@/components/DonutRing.vue'
import { asTyped, categoryColour } from '@/components/spending'
import SectionCaption from '@/components/SectionCaption.vue'

/**
 * What a ring draws: the month's answer as it is, or the year's with its categories named (MOL-160,
 * Р-13). Every figure is the server's; `spent` null is a sum past what money holds.
 */
export interface DonutData {
  readonly spendCurrency: Currency
  readonly incomeCurrency: Currency
  readonly spent: Money | null
  readonly spentIncome: Money | null
  readonly uncounted: readonly Money[]
  readonly slices: MoneyChartMonthView['slices']
  readonly categories: readonly SpendingCategoryView[]
}

/** The key of «Остальные» among the sectors: a category's is its id. */
const REST = 'rest'
/** The full ring's thickness, of the hundred it is drawn in (handoff MOL-157, 03). */
const THICKNESS = 12

/**
 * «Куда ушли» of «Графики» (MOL-158, MOL-160, handoff MOL-157 03 and 04): the ring of a month or a
 * year at full size, its total in the centre under the words the screen gives, and a legend that is a
 * radio group. A tap on a sector or a row
 * chooses it — thicker, the others dimmed, its row on a ground of its own, so the choice is seen by
 * more than colour — and **a second tap lets it go** (review Р-4). The sectors, their sums in both
 * currencies and who is in «Остальные» are the server's; the phone turns levels into angles and a
 * share into words (`shareOf`), nothing more.
 */
export default defineComponent({
  name: 'DonutChart',
  components: { AppCard, DonutRing, SectionCaption },
  props: {
    charts: { type: Object as PropType<DonutData>, required: true },
    /** Over the total in the centre: «Сентябрь · идёт», «2026 · 9 месяцев». */
    label: { type: String, required: true },
    /** A last line under the legend — «Каждый месяц — по курсу того месяца». */
    note: { type: String as PropType<string | null>, default: null },
    /**
     * Under the total with no «≈»: which month had no rate (MOL-160, review 14); an empty string
     * says nothing — a sum past money (adversarial М′); null — the month's own words.
     */
    noRate: { type: String as PropType<string | null>, default: null },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    /** The sector chosen — a category's id, `rest`, or null. */
    modelValue: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    'update:modelValue': (key: string | null) => key === null || typeof key === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const ringBox = ref<HTMLElement | null>(null)

    const whole = (value: Money) => formatEstimate(value, locale.value)
    const approx = (value: Money | null) => (value ? `≈ ${whole(value)}` : null)
    const both = computed(() => props.charts.spendCurrency !== props.charts.incomeCurrency)
    const percent = (value: number) =>
      new Intl.NumberFormat(locale.value, { style: 'percent' }).format(value / 100)

    const rows = computed(() =>
      props.charts.slices.map((slice) => {
        const category =
          slice.categoryId === null
            ? null
            : props.charts.categories.find((one) => one.id === slice.categoryId)
        const spent = props.charts.spent
        const share = spent && shareOf(slice.amount, spent)
        return {
          key: slice.categoryId ?? REST,
          name: category ? props.nameOf(category) : t('spending.charts.rest'),
          colour: category ? categoryColour(category) : 'var(--graphic)',
          level: slice.level,
          amount: whole(slice.amount),
          income: slice.income,
          share: share?.tiny ? t('spending.share_tiny') : percent(share?.percent ?? 0),
          members: slice.members,
        }
      }),
    )
    /** A month with nothing counted is still a ring, the dashed one of «no data» (MOL-183, С-13). */
    const sectors = computed<RingSector[]>(() =>
      rows.value.map(({ key, colour, level }) => ({ key, colour, level })),
    )
    const chosenRow = computed(() => rows.value.find((row) => row.key === props.modelValue))

    const centre = computed(() => {
      const row = chosenRow.value
      if (row) {
        const inIncome = both.value && row.income ? whole(row.income) : null
        return {
          label: row.name,
          figure: row.amount,
          sub: inIncome
            ? t('spending.charts.center_share', { share: row.share, amount: inIncome })
            : row.share,
        }
      }
      const spent = props.charts.spent
      // No sum is no «≈» and no rate to blame (adversarial М): «нет курса» under «—» was untrue. Nor is
      // nothing counted — «0 ֏ · ≈ 0 ₽» stood over «не посчитано: 50 $» (MOL-184, adversarial Б2).
      return {
        label: props.label,
        figure: spent ? whole(spent) : '—',
        sub:
          both.value && spent && spent.minor !== 0n
            ? (approx(props.charts.spentIncome) ?? props.noRate ?? t('spending.charts.no_rate'))
            : null,
      }
    })

    const uncounted = computed(() =>
      props.charts.uncounted.length > 0
        ? t('spending.charts.uncounted', {
            // As written, never rounded: no «≈» stands before it (MOL-184, adversarial Б1).
            amounts: props.charts.uncounted
              .map((amount) => asTyped(amount, locale.value))
              .join(', '),
          })
        : null,
    )
    /** «В «Остальных» — развлечения, транспорт»: the names of a preset in the run of a sentence. */
    const restNames = computed(() => {
      const members = rows.value.find((row) => row.key === REST)?.members ?? []
      if (members.length === 0) return null
      const names = members.map((member) => {
        const category = props.charts.categories.find((one) => one.id === member)
        if (!category) return ''
        const name = props.nameOf(category)
        return category.preset ? name.toLocaleLowerCase(locale.value) : name
      })
      return t('spending.charts.rest_names', {
        names: new Intl.ListFormat(locale.value, { type: 'conjunction' }).format(
          names.filter((name) => name !== ''),
        ),
      })
    })

    function choose(key: string): void {
      if (key !== props.modelValue) emit('update:modelValue', key)
    }
    /** A tap on the row already chosen lets it go; the arrows only ever choose (`change`). */
    function toggle(key: string): void {
      emit('update:modelValue', key === props.modelValue ? null : key)
    }

    /**
     * The sector under a tap on the ring: its angle, clockwise from twelve, against the levels — and
     * only on the band the sector is drawn as, the chosen one's wider inwards (adversarial Б): the hole
     * is the centre's words, the corners of the box are not the ring, and a tap on either chose or let
     * go a sector by the angle of the finger.
     */
    function tapRing(event: MouseEvent): void {
      const box = ringBox.value?.getBoundingClientRect()
      if (!box || box.width <= 0 || rows.value.length === 0) return
      const x = event.clientX - (box.left + box.width / 2)
      const y = event.clientY - (box.top + box.height / 2)
      const reach = (Math.hypot(x, y) * 100) / box.width
      if (reach > 50) return
      const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1
      let start = 0
      for (const row of rows.value) {
        start += row.level / CHART_LEVEL
        if (turn < start && row.level > 0) {
          const inner = 50 - THICKNESS - (row.key === props.modelValue ? CHOSEN_THICKER : 0)
          if (reach >= inner) toggle(row.key)
          return
        }
      }
    }

    // One ring, one name — the month's and the year's, and the one key of the ring on «Деньги» (Е-16, Д-5).
    const heading = computed(() => t('spending.categories_title'))

    return {
      t,
      id: useId(),
      heading,
      THICKNESS,
      ringBox,
      rows,
      sectors,
      centre,
      uncounted,
      restNames,
      choose,
      toggle,
      tapRing,
    }
  },
})
</script>

<style scoped lang="scss">
.card {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
}

.figure {
  display: grid;
  place-items: center;
  width: 13.25rem;
  height: 13.25rem;
  margin: 0 auto;
}

.ring-box {
  grid-area: 1 / 1;
  width: 100%;
  height: 100%;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.ring {
  width: 100%;
  height: 100%;
}

.center {
  display: flex;
  grid-area: 1 / 1;
  max-width: 8.5rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 0;
  text-align: center;
  pointer-events: none;
}

.center-label,
.center-sub {
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

.center-figure {
  @include display-type;

  font-size: var(--text-card-figure);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.legend {
  display: grid;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.unseen,
.radio {
  @include visually-hidden;
}

.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 2.5rem;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--touch-target);
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  /* Chosen is a fill and a ring, as a chosen row of the kit, never a weight: at 700 the row grew wider
     under the thumb, and `--surface-2` told it by a shade alone (Ф-5, MOL-186). */
  &.chosen {
    background: var(--accent-tint);
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  &:has(.radio:focus-visible) {
    @include focus-ring;
  }

  /* On a chosen row the focus stands inside its ring, the fill between them, as `ListRow` draws it: on
     the ring it was the same 2 px of the same colour (MOL-175, adversarial А1). */
  &.chosen:has(.radio:focus-visible) {
    @include focus-ring(-6px);
  }
}

.dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;

  /* On the tint a category's dot fell under 3:1 — ten light and four dark, «Остальные» 2.50 in the
     dark (MOL-172: marks 3:1). It stands on a ring of the card's own colour, where every mark holds
     3:1 (`tokens.test.ts`), as the day's dot of «Темп» does (MOL-186, review Р1-3, adversarial А2). */
  .chosen & {
    box-shadow: 0 0 0 2px var(--surface);
  }
}

.name,
.amount {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.amount {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.share {
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-variant-numeric: tabular-nums;
  text-align: right;

  /* `--text-muted` on a tint stands under 4.5:1 in both schemes (MOL-172): on the chosen row, `--text`. */
  .chosen & {
    color: var(--text);
  }
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}
</style>
