<template>
  <input
    class="switch"
    :class="{ live }"
    type="checkbox"
    role="switch"
    :checked="checked"
    @change="toggle"
  />
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'

/**
 * Kit switch (MOL-103): a native checkbox read out as a switch, for a setting saved on the tap. The
 * browser moves it under the finger and the owner answers with `checked` — what the server holds —
 * so a save that failed puts it back. `disabled`, `aria-describedby` and the rest fall through.
 *
 * **It moves only once a finger has moved it** (review №1): until then a change of `checked` is an
 * answer read — the setting as the server holds it, arriving after the screen — and an answer read
 * is not played (MOL-151). A switch drawn before its answer slid across on every opening of the
 * settings.
 */
export default defineComponent({
  name: 'AppSwitch',
  props: {
    checked: { type: Boolean, required: true },
  },
  emits: { toggle: (on: boolean) => typeof on === 'boolean' },
  setup(_props, { emit }) {
    const live = ref(false)
    function toggle(event: Event): void {
      live.value = true
      emit('toggle', (event.target as HTMLInputElement).checked)
    }
    return { live, toggle }
  },
})
</script>

<style scoped lang="scss">
.switch {
  position: relative;
  flex: none;
  width: var(--switch-width);
  height: var(--switch-height);
  margin: 0;
  border-radius: var(--radius-pill);
  background: var(--border-strong);
  cursor: pointer;
  appearance: none;

  &::before {
    position: absolute;
    top: var(--space-1);
    left: var(--space-1);
    width: calc(var(--switch-height) - 2 * var(--space-1));
    height: calc(var(--switch-height) - 2 * var(--space-1));
    border-radius: 50%;
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    content: '';
  }

  &.live {
    transition: background var(--dur-fast) var(--ease);
  }

  &.live::before {
    transition: transform var(--dur-fast) var(--ease);
  }

  &:checked {
    background: var(--accent-solid);
  }

  &:checked::before {
    transform: translateX(calc(var(--switch-width) - var(--switch-height)));
  }

  &:disabled {
    cursor: default;
    opacity: var(--opacity-stale);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

@media (prefers-reduced-motion: reduce) {
  .switch.live,
  .switch.live::before {
    transition: none;
  }
}
</style>
