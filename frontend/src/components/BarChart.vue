<template>
  <fieldset
    class="chart"
    :class="{ paired, coloured: colour !== null, many: bars.length > FEW }"
    :style="colour === null ? undefined : { '--bar-colour': colour }"
  >
    <legend class="unseen">{{ legend }}</legend>
    <div class="reading"><slot /></div>
    <div
      ref="area"
      class="area"
      :class="{ short }"
      @pointerdown="pointer.down"
      @pointermove="pointer.move"
      @pointerup="pointer.up"
      @pointercancel="pointer.cancel"
    >
      <span
        v-if="average !== null"
        class="average"
        :style="{ height: heightOf(average) }"
        aria-hidden="true"
      ></span>
      <label
        v-for="(bar, index) in bars"
        :key="bar.key"
        class="bar"
        :class="{ chosen: index === modelValue }"
      >
        <input
          type="radio"
          class="radio"
          :name="name"
          :value="index"
          :checked="index === modelValue"
          :aria-label="bar.spoken"
          @change="choose(index)"
        />
        <span
          v-if="paired"
          class="fill outline"
          :style="{ height: heightOf(bar.outline ?? 0) }"
          aria-hidden="true"
        ></span>
        <span
          class="fill"
          :class="{ unknown: bar.level === null }"
          :style="{ height: bar.level === null ? '100%' : heightOf(bar.level) }"
          aria-hidden="true"
        ></span>
      </label>
    </div>
    <div class="labels" aria-hidden="true">
      <span
        v-for="(bar, index) in bars"
        :key="bar.key"
        class="label"
        :class="{ chosen: index === modelValue }"
      >
        {{ bar.label }}
      </span>
    </div>
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, ref, useId } from 'vue'
import type { PropType } from 'vue'
import { CHART_LEVEL } from '@molvia/model'
import { useChartPointer } from '@/composables/useChartPointer'

export interface ChartBar {
  /** The month, `YYYY-MM`. */
  readonly key: string
  /** Under the bar: «апр». */
  readonly label: string
  /** What the bar says to a screen reader: «Август 2026, 345 620 ֏». */
  readonly spoken: string
  /**
   * Its height in thousandths of the tallest — the server's (`CHART_LEVEL`). Null is «not known» —
   * «Ушло» of a month with no rate — drawn as a dashed empty bar, never as nothing spent (review).
   */
  readonly level: number | null
  /** The bar before it in a pair, drawn as an outline — «Пришло» beside «Ушло». */
  readonly outline?: number | null
}

/** Six bars and fewer stand apart; twelve stand close (handoff 03). */
const FEW = 6

/**
 * The bars of «Графики» (MOL-74, handoff 03) — one component for the three bar charts: a reading
 * above the bars instead of a tip under the finger, and the whole area as the target, so a finger
 * picks the bar it is over and drags along them (`useChartPointer`; `touch-action: pan-y` leaves the
 * page its scroll).
 * The bars are radios: arrows move the choice and every bar is read by its month and amount — which
 * is why the reading is not a live region: the radio already says it, and a drag would chatter.
 * HTML and tokens, no library (Р-1): the scheme changes by itself and the words are text.
 */
export default defineComponent({
  name: 'BarChart',
  props: {
    bars: { type: Array as PropType<readonly ChartBar[]>, required: true },
    modelValue: { type: Number, required: true },
    legend: { type: String, required: true },
    /** Bars in pairs: `outline` outlined, `level` filled. */
    paired: { type: Boolean, default: false },
    /** One colour for every bar, the chosen one full — a category's (handoff 03). */
    colour: { type: String as PropType<string | null>, default: null },
    /** A dashed line at this level — the average of the period. */
    average: { type: Number as PropType<number | null>, default: null },
    /** 120 px of bars rather than 150 (handoff 03, «Категория во времени»). */
    short: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (index: number) => Number.isInteger(index),
  },
  setup(props, { emit }) {
    const area = ref<HTMLElement | null>(null)

    function choose(index: number): void {
      if (index !== props.modelValue) emit('update:modelValue', index)
    }

    /** The bar under the pointer: the area is cut into as many columns as there are bars. */
    const pointer = useChartPointer(area, (fraction) => {
      const n = props.bars.length
      if (n > 0) choose(Math.min(n - 1, Math.floor(fraction * n)))
    })

    const heightOf = (level: number) => `${String((level * 100) / CHART_LEVEL)}%`

    return { FEW, area, name: useId(), choose, pointer, heightOf }
  },
})
</script>

<style scoped lang="scss">
.chart {
  --bar-colour: var(--accent);

  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.unseen,
.radio {
  @include visually-hidden;
}

.reading {
  min-height: 4.875rem;
}

.area {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  height: 9.375rem;
  margin-top: var(--space-3);
  touch-action: pan-y;

  &.short {
    height: 7.5rem;
  }

  .many & {
    gap: var(--space-1);
  }
}

.average {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  border-top: 1.5px dashed var(--border-strong);
  pointer-events: none;
}

.bar {
  position: relative;
  display: flex;
  flex: 1;
  align-items: flex-end;
  justify-content: center;
  gap: var(--space-1);
  height: 100%;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  &:has(.radio:focus-visible) {
    @include focus-ring;

    border-radius: var(--radius-sm);
  }
}

.fill {
  width: 100%;
  max-width: 2.25rem;
  min-height: 2px;
  border-radius: 8px 8px 3px 3px;
  background: var(--border-strong);
  transition: background-color var(--dur-fast) var(--ease-out);

  .chosen & {
    background: var(--bar-colour);
  }

  .coloured & {
    background: var(--bar-colour);
    opacity: 0.42;
  }

  .coloured .chosen & {
    opacity: 1;
  }
}

.fill.unknown {
  background: none;
  box-shadow: none;
  outline: 1.5px dashed var(--border-strong);
  outline-offset: -1.5px;
  opacity: 1;
}

.paired .fill {
  max-width: 1.25rem;
  border-radius: 6px 6px 2px 2px;
}

.outline {
  background: none;
  box-shadow: inset 0 0 0 2px var(--text-muted);

  .chosen & {
    background: none;
    box-shadow: inset 0 0 0 2px var(--text);
  }
}

.labels {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-1);

  .many & {
    gap: var(--space-1);
  }
}

.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-medium);
  text-align: center;
  white-space: nowrap;

  &.chosen {
    color: var(--text);
    font-weight: var(--weight-bold);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fill {
    transition: none;
  }
}
</style>
