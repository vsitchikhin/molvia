<template>
  <div class="rate-line">
    <div class="reading"><slot /></div>
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
          class="cursor"
          :x1="xOf(modelValue)"
          y1="0"
          :x2="xOf(modelValue)"
          y2="1000"
          vector-effect="non-scaling-stroke"
        />
        <polyline
          v-for="run in runs"
          :key="run.from"
          class="line"
          :points="run.points"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-for="dot in lone"
          :key="`lone-${String(dot.x)}`"
          class="dot"
          :x1="dot.x"
          :y1="dot.y"
          :x2="dot.x"
          :y2="dot.y"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-for="(mark, index) in marks"
          :key="`mark-${String(index)}`"
          class="mark"
          :class="{ chosen: mark.week === modelValue }"
          :x1="xOf(mark.week)"
          :y1="yOf(mark.level)"
          :x2="xOf(mark.week)"
          :y2="yOf(mark.level)"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="chosenLevel !== null"
          class="dot chosen"
          :x1="xOf(modelValue)"
          :y1="yOf(chosenLevel)"
          :x2="xOf(modelValue)"
          :y2="yOf(chosenLevel)"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <input
        class="range"
        type="range"
        min="0"
        :max="Math.max(0, points.length - 1)"
        step="1"
        :value="modelValue"
        :aria-label="legend"
        :aria-valuetext="points[modelValue]?.spoken"
        @input="typed"
      />
    </div>
    <div class="ends" aria-hidden="true">
      <span>{{ first }}</span>
      <span>{{ last }}</span>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { CHART_LEVEL } from '@molvia/model'
import { useChartPointer } from '@/composables/useChartPointer'

export interface RatePoint {
  /** Its height in thousandths between the lowest and the highest — the server's; null is a gap. */
  readonly level: number | null
  /** What the week says to a screen reader: «Неделя по 27 сентября: 4,06 ֏ за ₽». */
  readonly spoken: string
}

/** The line keeps a tenth of the card clear above and below, so a dot is never cut. */
const MARGIN = 100

/**
 * The rate of the pair by week (MOL-74, owner's decision В-4, Р-14): a line of the central bank's
 * rate, broken where there was none — a gap, never a zero — and the person's own exchanges as dots
 * on it. SVG drawn by hand, no library (Р-1): stretched to the card, its strokes keep their width.
 * The week is chosen as a bar is — under the finger, anywhere on the card — and by the arrows of a
 * native range, which also says the week and its rate to a screen reader.
 */
export default defineComponent({
  name: 'RateLine',
  props: {
    points: { type: Array as PropType<readonly RatePoint[]>, required: true },
    /** The person's exchanges: the week each falls in, and its height. */
    marks: {
      type: Array as PropType<readonly { week: number; level: number }[]>,
      default: () => [],
    },
    modelValue: { type: Number, required: true },
    legend: { type: String, required: true },
    /** Under the line, at its ends: the first and the last week. */
    first: { type: String, required: true },
    last: { type: String, required: true },
  },
  emits: {
    'update:modelValue': (index: number) => Number.isInteger(index),
  },
  setup(props, { emit }) {
    const area = ref<HTMLElement | null>(null)

    const xOf = (index: number) =>
      props.points.length <= 1 ? 500 : (index * 1000) / (props.points.length - 1)
    const yOf = (level: number) => 1000 - MARGIN - (level * (1000 - 2 * MARGIN)) / CHART_LEVEL

    /** The unbroken stretches of the line; a week alone between two gaps is a dot. */
    const stretches = computed(() => {
      const found: { from: number; coords: { x: number; y: number }[] }[] = []
      props.points.forEach((point, index) => {
        if (point.level === null) return
        const coord = { x: xOf(index), y: yOf(point.level) }
        const open = found.at(-1)
        const before = props.points[index - 1]
        if (open && before && before.level !== null) open.coords.push(coord)
        else found.push({ from: index, coords: [coord] })
      })
      return found
    })
    const runs = computed(() =>
      stretches.value
        .filter((run) => run.coords.length > 1)
        .map((run) => ({
          from: run.from,
          points: run.coords.map(({ x, y }) => `${String(x)},${String(y)}`).join(' '),
        })),
    )
    const lone = computed(() =>
      stretches.value.flatMap((run) => (run.coords.length === 1 ? run.coords : [])),
    )
    const chosenLevel = computed(() => props.points[props.modelValue]?.level ?? null)

    function choose(index: number): void {
      if (index !== props.modelValue) emit('update:modelValue', index)
    }

    /** The week nearest the pointer. */
    const pointer = useChartPointer(area, (fraction) => {
      const n = props.points.length
      if (n > 0) choose(Math.round(fraction * (n - 1)))
    })

    function typed(event: Event): void {
      choose(Number((event.target as HTMLInputElement).value))
    }

    return { area, xOf, yOf, runs, lone, chosenLevel, pointer, typed }
  },
})
</script>

<style scoped lang="scss">
.reading {
  min-height: 4.875rem;
}

.area {
  position: relative;
  height: 7.5rem;
  margin-top: var(--space-3);
  border-radius: var(--radius-sm);
  touch-action: pan-y;

  &:has(.range:focus-visible) {
    @include focus-ring;
  }
}

.plot {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.line {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2.5;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.cursor {
  stroke: var(--border-strong);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
}

.dot {
  stroke: var(--accent);
  stroke-width: 7;
  stroke-linecap: round;

  &.chosen {
    stroke-width: 11;
  }
}

/* One's own exchange: the ink of the text, not the accent, so it stands apart from the line. */
.mark {
  stroke: var(--text);
  stroke-width: 9;
  stroke-linecap: round;

  &.chosen {
    stroke-width: 13;
  }
}

.range {
  @include visually-hidden;
}

.ends {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
}
</style>
