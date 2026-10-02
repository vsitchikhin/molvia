<template>
  <input class="switch" type="checkbox" role="switch" :checked="checked" @change="toggle" />
</template>

<script lang="ts">
import { defineComponent } from 'vue'

/**
 * Kit switch (MOL-103): a native checkbox read out as a switch, for a setting saved on the tap. The
 * browser moves it under the finger and the owner answers with `checked` — what the server holds —
 * so a save that failed puts it back. `disabled`, `aria-describedby` and the rest fall through.
 */
export default defineComponent({
  name: 'AppSwitch',
  props: {
    checked: { type: Boolean, required: true },
  },
  emits: { toggle: (on: boolean) => typeof on === 'boolean' },
  setup(_props, { emit }) {
    function toggle(event: Event): void {
      emit('toggle', (event.target as HTMLInputElement).checked)
    }
    return { toggle }
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
  transition: background var(--dur-fast) var(--ease);
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
    transition: transform var(--dur-fast) var(--ease);
    content: '';
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
  .switch,
  .switch::before {
    transition: none;
  }
}
</style>
