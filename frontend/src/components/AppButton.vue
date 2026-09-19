<template>
  <button
    class="button"
    :class="[variant, { large: size === 'large', block }]"
    :type="type"
    :disabled="disabled"
    :aria-label="label"
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

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger-ghost' | 'icon'

/**
 * Every button of 0.1, in the five looks the handoff has. A button and only a button: a move
 * between screens goes through `useNavigation` in the click handler, so no variant renders a
 * link that would write the history past the rules of «back».
 *
 * `type` is `button` unless asked otherwise — inside a `<form>` the browser's default submits
 * it. `label` is the accessible name of an icon-only button, which has no text to be read; a
 * button with text does not need one and should not get one, since it would replace the text
 * for voice control.
 *
 * No spinner and no loading state: saving is local and instant, sending is in the background.
 */
export default defineComponent({
  name: 'AppButton',
  props: {
    variant: { type: String as PropType<ButtonVariant>, default: 'primary' },
    size: { type: String as PropType<'regular' | 'large'>, default: 'regular' },
    block: { type: Boolean, default: false },
    type: { type: String as PropType<'button' | 'submit' | 'reset'>, default: 'button' },
    disabled: { type: Boolean, default: false },
    label: { type: String, default: undefined },
  },
  setup(props) {
    if (import.meta.env.DEV && props.variant === 'icon' && !props.label) {
      console.warn('[AppButton] an icon-only button needs a label: nothing else names it')
    }
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
    background-color var(--dur-fast) var(--ease-out);
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    @include focus-ring;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
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

  /* 22 — the handoff's icon inside a button */
  font-size: 1.375rem;

  :deep(svg) {
    width: 1em;
    height: 1em;
  }
}

/* Only an icon: a 44px circle. */
.icon {
  padding: 0;
  border-radius: 50%;
  background: var(--surface-2);
  color: var(--text-muted);
}

.large {
  min-height: var(--touch-target-lg);
}

.block {
  display: flex;
  width: 100%;
}

@media (hover: hover) {
  .primary:enabled:hover {
    filter: brightness(1.06);
  }

  .secondary:enabled:hover {
    background: var(--surface-2);
  }

  .ghost:enabled:hover {
    background: var(--accent-tint);
  }

  .icon:enabled:hover {
    background: var(--border);
    color: var(--text);
  }
}

.primary:enabled:active {
  filter: brightness(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .button {
    transition: none;
  }
}
</style>
