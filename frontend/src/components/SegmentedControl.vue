<template>
  <fieldset class="segmented" :class="{ fit, inactive: inactive || disabled }" :disabled="disabled">
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
          :aria-disabled="inactive ? 'true' : undefined"
          @click="hold"
          @keydown="holdArrows"
          @change="choose(option.value, $event)"
        />
        <span class="word" :aria-hidden="option.spoken ? 'true' : undefined">{{
          option.label
        }}</span>
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

/** Where an arrow takes the focus: as the platform moves the choice, back or forth, round the end. */
const ARROWS: Record<string, -1 | 1> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }

/**
 * One choice out of a few — the unit in the sheet (kg · l · pc), the rate (mine · official).
 *
 * Radio buttons in a fieldset, drawn as segments. The platform brings the rest: arrows move the
 * choice, the group is announced by its legend, and a tap anywhere on the segment selects it.
 * The radios are hidden from the eye, not from the page — `display: none` would take them out of
 * the keyboard order along with everything they give.
 *
 * **Chosen is a fill** (Ф-5, MOL-174): `accent-solid` with `on-accent`, every word at 600, so the
 * chosen unit is seen in the dark too and no segment changes width on a tap.
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
     * The choice cannot be made now, and the screen says why (Ф-6, MOL-174; handoff 81 4a): the
     * group stays one stop with `aria-disabled` on every radio, the arrows walk the focus over all of
     * them without choosing — so every option is heard — and a tap moves nothing. `disabled` is
     * drawn the same and takes the radios out of the order — for a moment, as while the message is
     * on its way.
     */
    inactive: { type: Boolean, default: false },
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
  setup(props, { emit }) {
    if (import.meta.env.DEV && props.options.length > MOST) {
      console.warn(`[SegmentedControl] ${String(props.options.length)} segments: use a <select>`)
    }
    const name = useId()
    /** A cancelled click puts the radio back: a tap, and the click a browser sends for an arrow. */
    function hold(event: MouseEvent): void {
      if (props.inactive) event.preventDefault()
    }
    /**
     * The arrow's own move is the choice and the focus at once; inactive, only the focus goes —
     * by hand, since a radio given the focus by a script is not checked (adversarial А2: cancelled
     * whole, the two other options could not be reached at all).
     */
    function holdArrows(event: KeyboardEvent): void {
      const by = ARROWS[event.key]
      // With a modifier the arrow is the browser's or the system's (Alt+← is «back»), and a live
      // group lets it by too (adversarial round 2, Р2-А3).
      const modified = event.altKey || event.ctrlKey || event.metaKey
      if (!props.inactive || by === undefined || modified) return
      event.preventDefault()
      const radio = event.target as HTMLInputElement
      const radios = [
        ...(radio.closest('.track')?.querySelectorAll<HTMLInputElement>('.radio') ?? []),
      ]
      const at = radios.indexOf(radio)
      radios[(at + by + radios.length) % radios.length]?.focus()
    }
    function choose(value: string, event: Event): void {
      if (!props.inactive) {
        emit('update:modelValue', value)
        return
      }
      // Whatever got past the two above: the choice stays the one the owner holds.
      const track = (event.target as HTMLElement).closest('.track')
      for (const radio of track?.querySelectorAll<HTMLInputElement>('.radio') ?? []) {
        radio.checked = radio.value === props.modelValue
      }
    }
    return { name, hold, holdArrows, choose }
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
  border-radius: calc(var(--radius) - var(--segment-inset));
  color: var(--text-muted);
  font-weight: var(--weight-medium);
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

/* Its word is its basis, never wrapped; every word is at one weight, so nothing shifts on a tap. */
.fit .segment {
  flex: 1 1 auto;
  padding: 0 var(--space-2);
  white-space: nowrap;
}

.on {
  background: var(--accent-solid);
  color: var(--on-accent);
  box-shadow: var(--shadow-sm);
}

/* Not now (handoff 81 4a): the chosen one keeps its place by an edge and its word, not by the fill
   of a choice that can be made; no opacity (Ф-6). The edge is `graphic` — it carries meaning, and
   `border-strong` at 1.65:1 lost the choice in bad light, the very Н-3 of this control (adversarial
   А1) — and the chosen word stays `text` beside the others' `text-muted`. */
.inactive .segment {
  color: var(--text-muted);
  cursor: default;
}

.inactive .on {
  background: var(--surface);
  box-shadow: inset 0 0 0 var(--hairline) var(--graphic);
  color: var(--text);
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
