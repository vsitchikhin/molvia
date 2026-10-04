<template>
  <button
    class="button"
    :class="[variant, { large: size === 'large', block }]"
    :type="type"
    :disabled="disabled"
    :aria-label="label"
    :aria-disabled="inactive || busy ? true : undefined"
    :aria-busy="busy || undefined"
    @click="click"
  >
    <!-- An icon-only button draws its icon from the default slot; the label names it. -->
    <span v-if="variant === 'icon'" class="glyph" aria-hidden="true"><slot /></span>
    <template v-else>
      <span v-if="$slots.icon" class="glyph" aria-hidden="true"><slot name="icon" /></span>
      <slot />
    </template>
  </button>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'

export type ButtonVariant = 'primary' | 'secondary' | 'tinted' | 'ghost' | 'danger-ghost' | 'icon'

/**
 * Every button of the kit, in its six looks. A button and only a button: a move
 * between screens goes through `useNavigation` in the click handler, so no variant renders a
 * link that would write the history past the rules of «back».
 *
 * `type` is `button` unless asked otherwise — inside a `<form>` the browser's default submits
 * it. `label` is the accessible name of an icon-only button, which has no text to be read; a
 * button with text does not need one and should not get one, since it would replace the text
 * for voice control.
 *
 * Network-backed actions can be busy; inactive keeps the action focusable and described.
 *
 * **Inactive is one look** (Ф-6, MOL-174): `text-muted` at 600 with no opacity, on `surface-2` where
 * the live button has a fill and on nothing where it has none — the form of the variant stays, so a
 * ghost under an inactive primary is not a second grey pill (the owner's В-1). `disabled` draws the
 * same; it differs only in leaving the focus order, which the screens trade for `inactive` along
 * with the words saying why.
 */
export default defineComponent({
  name: 'AppButton',
  props: {
    variant: { type: String as PropType<ButtonVariant>, default: 'primary' },
    size: { type: String as PropType<'regular' | 'large'>, default: 'regular' },
    block: { type: Boolean, default: false },
    type: { type: String as PropType<'button' | 'submit' | 'reset'>, default: 'button' },
    busy: { type: Boolean, default: false },
    inactive: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    label: { type: String, default: undefined },
  },
  emits: { click: (event: MouseEvent) => event instanceof MouseEvent },
  setup(props, { emit }) {
    if (import.meta.env.DEV && props.variant === 'icon' && !props.label) {
      console.warn('[AppButton] an icon-only button needs a label: nothing else names it')
    }
    function click(event: MouseEvent): void {
      if (props.disabled || props.inactive || props.busy) {
        // Stopped as well as prevented: a `disabled` button fires no click at all, and an
        // inactive one must not reach a handler above it either (MOL-65, review).
        event.preventDefault()
        event.stopPropagation()
        return
      }
      emit('click', event)
    }
    return { click }
  },
})
</script>

<style scoped lang="scss">
.button {
  @include touch-target;

  gap: var(--space-2);
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-pill);
  font-family: var(--font);
  font-size: var(--text-body);
  line-height: var(--leading-snug);
  cursor: pointer;
  transition:
    filter var(--dur-fast) var(--ease-out),
    background-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring;
  }
}

.primary {
  background: var(--accent-solid);
  color: var(--on-accent);
  font-weight: var(--weight-bold);
  box-shadow: var(--shadow-sm);
}

.secondary {
  border: var(--hairline) solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-weight: var(--weight-medium);
}

.tinted {
  background: var(--accent-tint);
  color: var(--accent-ink);
  font-weight: var(--weight-medium);
}

.ghost,
.danger-ghost {
  background: transparent;
  font-weight: var(--weight-medium);
}

.ghost {
  color: var(--accent-ink);
}

.danger-ghost {
  color: var(--bad-ink);
}

.glyph {
  display: inline-flex;
  flex: none;
  font-size: var(--icon-button);

  :deep(svg) {
    @include icon;
  }
}

/* Only an icon: a 44px circle, its glyph a step larger than one beside a word, in `text` while it
   can be pressed and `text-muted` when it cannot (MOL-118 В-15). */
.icon {
  padding: 0;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text);

  // Its own glyph only: `.icon .glyph` would take any ancestor wearing `icon`.
  & > .glyph {
    font-size: var(--icon-md);
  }
}

/* After every variant, so it wins over each of them. `busy` alone keeps the look of the action, as
   on master: it is the one at work, and saying so is the screen's — its words («Сохраняем…») or a
   status line; where the screen says nothing, only `aria-busy` does — among others «Удалить
   навсегда», «Не тот товар», the login (round 3, Р3-А1; round 4 counted nine). `busy` with `disabled` is drawn as not now, as master drew it dimmed: a
   sheet that keeps its «Сохранить» while it sends has nothing else to show it (round 2, Р2-А1). A
   look of its own for `busy` is not the kit's yet. */
.button:disabled,
.button[aria-disabled='true']:not([aria-busy='true']) {
  background: var(--surface-2);
  color: var(--text-muted);
  font-weight: var(--weight-medium);
  cursor: not-allowed;
}

/* The rest shadow is a live primary's. Light in weight (`:where`), so a place that lifts what it
   holds over the cards — the floating dock — keeps its lift on an inactive one (review 1). */
.primary:where(:disabled, [aria-disabled='true']:not([aria-busy='true'])) {
  box-shadow: none;
}

.ghost:disabled,
.danger-ghost:disabled,
.ghost[aria-disabled='true']:not([aria-busy='true']),
.danger-ghost[aria-disabled='true']:not([aria-busy='true']) {
  background: transparent;
}

.secondary:disabled,
.secondary[aria-disabled='true']:not([aria-busy='true']) {
  border-color: transparent;
}

.large {
  min-height: var(--touch-target-lg);
}

.block {
  display: flex;
  width: 100%;
}

/* `aria-disabled` is still `:enabled`: the press and the hover read both, or an inactive button
   lit up under the pointer as a live one does. */
@media (hover: hover) {
  .primary:not(:disabled, [aria-disabled='true']):hover {
    filter: brightness(1.06);
  }

  .tinted:not(:disabled, [aria-disabled='true']):hover {
    filter: brightness(0.97);
  }

  .secondary:not(:disabled, [aria-disabled='true']):hover {
    background: var(--surface-2);
  }

  .ghost:not(:disabled, [aria-disabled='true']):hover {
    background: var(--accent-tint);
  }

  .icon:not(:disabled, [aria-disabled='true']):hover {
    background: var(--border);
  }
}

.primary:not(:disabled, [aria-disabled='true']):active,
.tinted:not(:disabled, [aria-disabled='true']):active {
  filter: brightness(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
</style>
