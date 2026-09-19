<template>
  <fieldset class="segmented">
    <legend class="legend" :class="{ hidden: hideLegend }">{{ legend }}</legend>
    <div class="track">
      <label
        v-for="option in options"
        :key="option.value"
        class="segment"
        :class="{ on: option.value === modelValue }"
      >
        <input
          class="radio"
          type="radio"
          :name="name"
          :value="option.value"
          :checked="option.value === modelValue"
          @change="$emit('update:modelValue', option.value)"
        />
        {{ option.label }}
      </label>
    </div>
  </fieldset>
</template>

<script lang="ts">
import { defineComponent, useId } from 'vue'
import type { PropType } from 'vue'

export interface Segment {
  value: string
  label: string
}

/** More than this stops fitting a phone's width; the handoff sends it to a `<select>`. */
const MOST = 4

/**
 * One choice out of a few — the unit in the sheet (kg · l · pc), the rate (mine · official).
 *
 * Radio buttons in a fieldset, drawn as segments. The platform brings the rest: arrows move the
 * choice, the group is announced by its legend, and a tap anywhere on the segment selects it.
 * The radios are hidden from the eye, not from the page — `display: none` would take them out of
 * the keyboard order along with everything they give.
 */
export default defineComponent({
  name: 'SegmentedControl',
  props: {
    modelValue: { type: String, required: true },
    options: { type: Array as PropType<Segment[]>, required: true },
    legend: { type: String, required: true },
    /** Where a label above would repeat what the screen already says; still read out. */
    hideLegend: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
  },
  setup(props) {
    if (import.meta.env.DEV && props.options.length > MOST) {
      console.warn(`[SegmentedControl] ${String(props.options.length)} segments: use a <select>`)
    }
    return { name: useId() }
  },
})
</script>

<style scoped lang="scss">
.segmented {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.legend {
  margin-bottom: var(--space-2);
  padding: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.hidden {
  @include visually-hidden;
}

.track {
  display: flex;

  /* The handoff's 3px is off the scale; the nearest step is one pixel more. */
  gap: var(--space-1);
  min-height: var(--touch-target);
  padding: var(--space-1);
  border-radius: var(--radius);
  background: var(--surface-2);

  /* The edge is drawn inside rather than taking room: every pixel of the 44 goes to the thumb. */
  box-shadow: inset 0 0 0 var(--hairline) var(--border);
}

.segment {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;

  &:has(.radio:focus-visible) {
    @include focus-ring;
  }

  /* The segment looks 36px tall, as in the handoff, but answers the thumb over the track's padding
     too — the full 44 of the rule (review Р-3, the owner's choice: the look stays). */
  &::after {
    position: absolute;
    inset: calc(var(--space-1) * -1) 0;
    content: '';
  }
}

.on {
  background: var(--surface);
  color: var(--text);
  font-weight: var(--weight-medium);
  box-shadow: var(--shadow-sm);
}

.radio {
  @include visually-hidden;
}

@media (prefers-reduced-motion: reduce) {
  .segment {
    transition: none;
  }
}
</style>
