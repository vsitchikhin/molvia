<template>
  <fieldset class="segmented" :class="{ fit }" :disabled="disabled">
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
        <span
          class="word"
          :data-word="option.label"
          :aria-hidden="option.spoken ? 'true' : undefined"
          >{{ option.label }}</span
        >
        <span v-if="option.spoken" class="spoken">{{ option.spoken }}</span>
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
  /** Said instead of the label where the label is a sign: «Драмы», not «֏» (MOL-82). */
  spoken?: string
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
    /**
     * The choice cannot be made right now — no connection, or the last one still on its way
     * (MOL-40, review С-2). On the fieldset, so every radio and the arrows go quiet at once.
     */
    disabled: { type: Boolean, default: false },
    /**
     * Each segment as wide as its word, the room left shared out evenly — for words of unequal
     * length, where even thirds cut the longest: «Системная · Светлая · Тёмная» on a 320 px phone
     * (MOL-111, the owner's В-1). iOS calls it `apportionsSegmentWidthsByContent`.
     */
    fit: { type: Boolean, default: false },
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
.spoken {
  @include visually-hidden;
}

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
  /* Its own stacking context: the word is lifted over its segment's hit area (below), and without
     this it rose over everything of the same level — the pinned header too, which a segment
     scrolled under it then drew through and took the taps of («‹ Деньги» on «Графики»). */
  isolation: isolate;
  display: flex;
  gap: var(--segment-inset);
  min-height: var(--touch-target);
  padding: var(--segment-inset);
  border-radius: var(--radius);
  background: var(--surface-2);

  /* The edge is drawn inside rather than taking room: every pixel of the 44 goes to the thumb. */
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);
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

  /* The segment looks 38px tall, as in the handoff, but answers the thumb over the track's padding
     too — the full 44 of the rule (review Р-3, the owner's choice: the look stays). */
  &::after {
    position: absolute;
    inset: calc(var(--segment-inset) * -1) 0;
    content: '';
  }
}

/* Over the segment's own hit area (`::after`), so a tap on the word lands on the word — and on the
   label through it — rather than on the box laid over it. Within the track alone (`isolation`). */
.word {
  position: relative;
  z-index: 1;
}

/* Its word is its basis, never wrapped; the semibold of the chosen one is reserved under every
   word, or the segments would shift by a pixel on each tap. */
.fit .segment {
  flex: 1 1 auto;
  padding: 0 var(--space-2);
  white-space: nowrap;
}

.fit .word {
  display: inline-flex;
  flex-direction: column;

  &::before {
    height: 0;
    overflow: hidden;
    font-weight: var(--weight-medium);
    visibility: hidden;
    content: attr(data-word);
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
