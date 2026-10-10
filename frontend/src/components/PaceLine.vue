<template>
  <div class="pace">
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
          class="base"
          x1="0"
          y1="1000"
          x2="1000"
          y2="1000"
          vector-effect="non-scaling-stroke"
        />
        <line
          v-if="days.length > 0"
          class="cursor"
          :x1="xOf(modelValue)"
          y1="0"
          :x2="xOf(modelValue)"
          y2="1000"
          vector-effect="non-scaling-stroke"
        />
        <polyline
          v-if="usualPoints"
          class="usual"
          :points="usualPoints"
          vector-effect="non-scaling-stroke"
        />
        <polyline
          v-if="days.length > 1"
          class="line"
          :points="dayPoints"
          vector-effect="non-scaling-stroke"
        />
        <template v-if="usualAt !== null">
          <line
            v-for="part in ['ring', 'hole']"
            :key="part"
            :class="part"
            :x1="xOf(modelValue)"
            :y1="yOf(usualAt)"
            :x2="xOf(modelValue)"
            :y2="yOf(usualAt)"
            vector-effect="non-scaling-stroke"
          />
        </template>
        <template v-if="chosenAt !== null">
          <line
            v-for="part in ['dot-edge', 'dot']"
            :key="part"
            :class="part"
            :x1="xOf(modelValue)"
            :y1="yOf(chosenAt)"
            :x2="xOf(modelValue)"
            :y2="yOf(chosenAt)"
            vector-effect="non-scaling-stroke"
          />
        </template>
      </svg>
    </div>
    <div class="labels" aria-hidden="true">
      <span
        v-for="tick in ticks"
        :key="tick"
        class="tick"
        :style="{ left: `${String(xOf(tick - 1) / 10)}%` }"
      >
        {{ tick }}
      </span>
    </div>
    <!-- In sight under the axis (С-14, Д-5): a finger on the chart chooses too, but a slider says it can
         be moved before anyone tries. One day drawn — the 1st of a running month — has nothing to move
         to, and no slider (adversarial А6). The strip around it, 44 high and as wide as the axis, is the
         target, chosen as the chart is (owner's «в» on review Р2-1); the range's own thumb drags. -->
    <div
      v-if="days.length > 1"
      ref="track"
      class="track"
      @pointerdown="strip.down"
      @pointermove="strip.move"
      @pointerup="strip.up"
      @pointercancel="strip.cancel"
    >
      <input
        class="range"
        type="range"
        min="0"
        :max="length - 1"
        step="1"
        :value="modelValue"
        :aria-label="legend"
        :aria-valuetext="days[modelValue]?.spoken"
        @input="typed"
      />
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { CHART_LEVEL } from '@molvia/model'
import { useChartPointer } from '@/composables/useChartPointer'

export interface PaceDayPoint {
  /** Its height in thousandths of the highest point of both lines — the server's. */
  readonly level: number
  /** What the day says to a screen reader: «12 сентября: 134 888 ֏, обычно 132 461 ֏». */
  readonly spoken: string
}

/** The line keeps a twentieth of the card clear above, so the dot at the top is not cut. */
const MARGIN = 50

/**
 * «Темп месяца» (MOL-158, handoff MOL-157 03): what was spent from the first of the month, day by
 * day — a solid line to the last day shown — against the usual month, dashed to the month's end:
 * the two told apart by their stroke, not their colour alone. The day is chosen as a bar is — on
 * lifting the finger or once it goes sideways, anywhere on the card, never by a scroll — and by the
 * slider in sight under the axis (С-14): a native range, whose arrows move the day and which says the
 * day and both sums to a screen reader. **The range takes no touch, its thumb does, and the strip around
 * it chooses as the chart does** (owner's «а» on review Р1-1, «в» on Р2-1): Blink sets a range's value
 * where the finger lands on the track, and a scroll started there changed the day as the page went up;
 * the thumb alone was a target of some 16 px. Every height is the server's.
 */
export default defineComponent({
  name: 'PaceLine',
  props: {
    days: { type: Array as PropType<readonly PaceDayPoint[]>, required: true },
    /** The usual month to its last day, a level a day; null — no usual yet. */
    usual: { type: Array as PropType<readonly number[] | null>, default: null },
    /** How many days the month has: where the line ends when the month is whole. */
    length: { type: Number, required: true },
    modelValue: { type: Number, required: true },
    legend: { type: String, required: true },
  },
  emits: {
    'update:modelValue': (index: number) => Number.isInteger(index),
  },
  setup(props, { emit }) {
    const area = ref<HTMLElement | null>(null)

    const xOf = (index: number) => (props.length <= 1 ? 0 : (index * 1000) / (props.length - 1))
    const yOf = (level: number) => 1000 - (level * (1000 - MARGIN)) / CHART_LEVEL
    const pointsOf = (levels: readonly number[]) =>
      levels.map((level, index) => `${String(xOf(index))},${String(yOf(level))}`).join(' ')

    const dayPoints = computed(() => pointsOf(props.days.map((day) => day.level)))
    const usualPoints = computed(() => (props.usual ? pointsOf(props.usual) : null))
    const chosenAt = computed(() => props.days[props.modelValue]?.level ?? null)
    const usualAt = computed(() => props.usual?.[props.modelValue] ?? null)
    /** 1, 10, 20 and the last day (handoff 03). */
    const ticks = computed(() => [1, 10, 20, props.length])

    function choose(index: number): void {
      if (index !== props.modelValue) emit('update:modelValue', index)
    }

    /** The nearest day, never one past the last drawn — the future of a running month. */
    function pick(fraction: number): void {
      const last = props.days.length - 1
      if (last >= 0) choose(Math.min(last, Math.round(fraction * (props.length - 1))))
    }
    const pointer = useChartPointer(area, pick)

    /**
     * The strip of the slider chooses as the chart does (owner's «в» on review Р2-1): only the thumb took
     * a touch after Р1-1 «а», a target of some 16 px. Its width is the axis's, so a place on it is the
     * day under it on the line; a press that lands on the thumb is the native drag's, and the strip
     * leaves it be — the two would set the day twice, half a thumb apart.
     */
    const track = ref<HTMLElement | null>(null)
    const onStrip = useChartPointer(track, pick)
    const fromThumb = (event: PointerEvent) => event.target instanceof HTMLInputElement
    const strip = {
      down: (event: PointerEvent) => {
        if (!fromThumb(event)) onStrip.down(event)
      },
      move: (event: PointerEvent) => {
        if (!fromThumb(event)) onStrip.move(event)
      },
      up: (event: PointerEvent) => {
        if (fromThumb(event)) onStrip.cancel()
        else onStrip.up(event)
      },
      cancel: onStrip.cancel,
    }

    /**
     * The slider spans the whole month, as the axis above it does, so its thumb stands under the day
     * chosen — to within half a thumb at the ends, where a native thumb stops short of the track's edge
     * (review Р1-4); a day past the last one drawn — the future of a running month — is the last one, and the
     * thumb goes back to it (MOL-186): spanning only the days drawn, it stood at the right end over the
     * 9th of 31.
     */
    function typed(event: Event): void {
      const range = event.target as HTMLInputElement
      const asked = Number(range.value)
      const day = Math.min(asked, props.days.length - 1)
      if (day !== asked) range.value = String(day)
      choose(day)
    }

    return {
      area,
      track,
      xOf,
      yOf,
      dayPoints,
      usualPoints,
      chosenAt,
      usualAt,
      ticks,
      pointer,
      strip,
      typed,
    }
  },
})
</script>

<style scoped lang="scss">
.reading {
  min-height: 4.875rem;
}

.area {
  position: relative;
  height: 9.375rem;
  margin-top: var(--space-3);
  border-radius: var(--radius-sm);
  touch-action: pan-y;
}

.plot {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.base {
  stroke: var(--border);
  stroke-width: 1;
}

.cursor {
  stroke: var(--accent);
  stroke-width: 1.5;
}

/* The series is data, in the ink of the text; the accent is only the day chosen (Ф-4, MOL-186). */
.line {
  fill: none;
  stroke: var(--text);
  stroke-width: 3;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.usual {
  fill: none;
  stroke: var(--graphic);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  stroke-linejoin: round;
}

/* A dot is a zero-length round-capped line: stretched with the plot, it stays a circle. Its edge of
   the card's own colour parts it from the line it sits on (handoff MOL-157 v2 03). */
.dot-edge {
  stroke: var(--surface);
  stroke-width: 15;
  stroke-linecap: round;
}

.dot {
  stroke: var(--accent);
  stroke-width: 11;
  stroke-linecap: round;
}

.ring,
.hole {
  stroke: var(--graphic);
  stroke-width: 9;
  stroke-linecap: round;
}

/* The usual's point is a ring, not a dot: hollow, so it is told from the month's by its shape. */
.hole {
  stroke: var(--surface);
  stroke-width: 5;
}

/* The strip of the slider: as wide as the axis, 44 high, the target a finger has (owner's «в» on
   review Р2-1); a scroll started on it leaves the page its scroll, as the chart does. */
.track {
  margin-top: var(--space-1);
  cursor: pointer;
  touch-action: pan-y;
}

/* A native range in the accent, the one thing on the card that is pressed (Ф-4): its own track and
   thumb, as each platform draws them — a second control of our own would be one more to keep. */
.range {
  display: block;
  width: 100%;
  min-height: var(--touch-target);
  margin: 0;
  accent-color: var(--accent);

  /* The range takes no touch (owner's «а» on review Р1-1): Blink sets the value where a finger lands
     on the track — a scroll started there moved the day from the 2nd to the 23rd. The strip around it
     chooses instead, on lifting or sideways; the thumb drags, and the keys are the input's. */
  pointer-events: none;

  &::-webkit-slider-thumb {
    cursor: pointer;
    pointer-events: auto;
  }

  &::-moz-range-thumb {
    cursor: pointer;
    pointer-events: auto;
  }

  &:focus-visible {
    @include focus-ring;

    border-radius: var(--radius-sm);
  }
}

.labels {
  position: relative;
  height: 1lh;
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
}

.tick {
  position: absolute;
  transform: translateX(-50%);

  &:first-child {
    transform: none;
  }

  &:last-child {
    transform: translateX(-100%);
  }
}
</style>
