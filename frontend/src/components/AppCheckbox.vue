<template>
  <label
    class="app-checkbox"
    :class="[attrs.class, { 'app-checkbox-inactive': inactive }]"
    :style="attrs.style"
  >
    <span class="box">
      <input
        v-bind="control()"
        class="input"
        type="checkbox"
        :checked="checked"
        :aria-disabled="inactive ? 'true' : undefined"
        @click="hold"
        @change="toggle"
      />
      <IconCheck class="check" aria-hidden="true" />
    </span>
    <span class="words"><slot /></span>
  </label>
</template>

<script lang="ts">
import { defineComponent, useAttrs } from 'vue'
import IconCheck from '~icons/mdi/check'

/**
 * Kit checkbox (MOL-235, Ф-12): a native checkbox drawn by the kit, its words beside it in a row of
 * a field's edge — «Мне 16 лет или больше» of the consent had been the browser's own box, a look per
 * platform and scheme, its focus the browser's and no «not now».
 *
 * **Off is a form, on is a fill and a ✓** (Ф-3, Ф-5): off is a square edged in `graphic` — data, not
 * decoration, as the switch's track — on is `accent-solid` with a ✓ of 18. **Not now is `inactive`**
 * (Ф-6, MOL-174): `aria-disabled`, still in the focus order, and neither a tap, a tap on its words nor
 * Space moves it; drawn on `surface-2` with its words in `text-muted` at 600, no opacity. The focus is
 * a field's (`field-focus`) on the whole row, which the tap takes. `v-model:checked`; every other
 * attribute goes to the checkbox, `class` and `style` to the row, where the layout is — as `AppField`'s
 * (self-review №4) — and the row's classes are the kit's words, a root carrying its screen's scope.
 */
export default defineComponent({
  name: 'AppCheckbox',
  components: { IconCheck },
  inheritAttrs: false,
  props: {
    checked: { type: Boolean, required: true },
    inactive: { type: Boolean, default: false },
  },
  emits: { 'update:checked': (on: boolean) => typeof on === 'boolean' },
  setup(props, { emit }) {
    const attrs = useAttrs()
    // A function, not a computed: attrs are not reactive (AppField's reason).
    function control(): Record<string, unknown> {
      return Object.fromEntries(
        Object.entries(attrs).filter(([name]) => name !== 'class' && name !== 'style'),
      )
    }
    /** A cancelled click leaves the checkbox as it was: a tap, a tap on its words, and Space. */
    function hold(event: MouseEvent): void {
      if (props.inactive) event.preventDefault()
    }
    function toggle(event: Event): void {
      emit('update:checked', (event.target as HTMLInputElement).checked)
    }
    return { attrs, control, hold, toggle }
  },
})
</script>

<style scoped lang="scss">
.app-checkbox {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target);
  padding: var(--space-2) var(--space-3);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  cursor: pointer;
  transition:
    border-color var(--dur-fast) var(--ease-out),
    outline-color var(--dur-fast) var(--ease-out);

  &:has(.input:focus-visible) {
    @include field-focus;
  }
}

/* The box and its ✓ in one cell, the ✓ over the checkbox and letting its taps through. */
.box {
  display: grid;
  flex: none;
  place-items: center;
}

.input {
  grid-area: 1 / 1;
  width: var(--space-6);
  height: var(--space-6);
  margin: 0;
  border: 2px solid var(--graphic);
  border-radius: var(--radius-sm);
  background: var(--surface);
  cursor: inherit;
  appearance: none;

  /* The ring is the row's. */
  outline: none;

  &:checked {
    border-color: var(--accent-solid);
    background: var(--accent-solid);
  }
}

.check {
  @include icon;

  font-size: var(--icon-sm);
  grid-area: 1 / 1;
  color: var(--on-accent);
  pointer-events: none;
  visibility: hidden;
}

.input:checked + .check {
  visibility: visible;
}

.words {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Not now, in either position: a well with an edge, the ✓ and the words muted (Ф-6). */
.app-checkbox-inactive {
  color: var(--text-muted);
  font-weight: var(--weight-medium);
  cursor: default;

  .input,
  .input:checked {
    border: var(--hairline) solid var(--border-strong);
    background: var(--surface-2);
  }

  .check {
    color: var(--text-muted);
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-checkbox {
    transition: none;
  }
}
</style>
