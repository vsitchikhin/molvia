<template>
  <span class="switch" :class="{ live, inactive: inactive || disabled }">
    <input
      v-bind="$attrs"
      class="input"
      type="checkbox"
      role="switch"
      :checked="checked"
      :disabled="disabled"
      :aria-disabled="inactive ? 'true' : undefined"
      @click="hold"
      @change="toggle"
    />
    <span class="knob" aria-hidden="true"><IconCheck class="check" /></span>
  </span>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import IconCheck from '~icons/mdi/check'

/**
 * Kit switch (MOL-103): a native checkbox read out as a switch, for a setting saved on the tap. The
 * browser moves it under the finger and the owner answers with `checked` — what the server holds —
 * so a save that failed puts it back. `aria-describedby`, `id` and the rest go to the checkbox.
 *
 * **On is a form, not only a colour** (Ф-5, MOL-174): a ✓ rides the knob; off is the track in
 * `graphic`, data rather than decoration (Ф-3). **Not now is `inactive`** (Ф-6): the checkbox stays
 * in the focus order with `aria-disabled`, so the hint saying why is read on reaching it, and
 * neither a tap nor Space — a click too — moves it. No opacity; `disabled` draws the same.
 *
 * **It moves only once a finger has moved it** (review №1): until then a change of `checked` is an
 * answer read — the setting as the server holds it, arriving after the screen — and an answer read
 * is not played (MOL-151). A switch drawn before its answer slid across on every opening of the
 * settings.
 */
export default defineComponent({
  name: 'AppSwitch',
  components: { IconCheck },
  inheritAttrs: false,
  props: {
    checked: { type: Boolean, required: true },
    inactive: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
  },
  emits: { toggle: (on: boolean) => typeof on === 'boolean' },
  setup(props, { emit }) {
    const live = ref(false)
    /** A cancelled click leaves the checkbox as it was: a tap, a tap on its label, and Space. */
    function hold(event: MouseEvent): void {
      if (props.inactive) event.preventDefault()
    }
    function toggle(event: Event): void {
      live.value = true
      emit('toggle', (event.target as HTMLInputElement).checked)
    }
    return { live, hold, toggle }
  },
})
</script>

<style scoped lang="scss">
.switch {
  position: relative;
  display: inline-flex;
  flex: none;
}

.input {
  width: var(--switch-width);
  height: var(--switch-height);
  margin: 0;
  border-radius: var(--radius-pill);
  background: var(--graphic);
  cursor: pointer;
  appearance: none;

  &:checked {
    background: var(--accent-solid);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

/* The knob over the track, carrying the ✓ of «on»; the taps go through it to the checkbox. */
.knob {
  position: absolute;
  top: var(--space-1);
  left: var(--space-1);
  display: grid;
  place-items: center;
  width: calc(var(--switch-height) - 2 * var(--space-1));
  height: calc(var(--switch-height) - 2 * var(--space-1));
  border-radius: 50%;
  background: var(--surface);
  box-shadow: var(--shadow-sm);
  color: var(--accent-solid);
  pointer-events: none;
}

.check {
  @include icon;

  font-size: var(--icon-xs);
  visibility: hidden;
}

.input:checked + .knob {
  transform: translateX(calc(var(--switch-width) - var(--switch-height)));

  .check {
    visibility: visible;
  }
}

.live .input {
  transition: background var(--dur-fast) var(--ease);
}

.live .knob {
  transition: transform var(--dur-fast) var(--ease);
}

/* Not now: a well with an edge and a muted knob, in either position (handoff 41 v2 05). */
.inactive .input {
  background: var(--surface-2);
  box-shadow: inset 0 0 0 var(--hairline) var(--border-strong);
  cursor: default;
}

.inactive .knob {
  background: var(--text-muted);
  box-shadow: none;
  color: var(--surface-2);
}

@media (prefers-reduced-motion: reduce) {
  .live .input,
  .live .knob {
    transition: none;
  }
}
</style>
