<template>
  <button
    class="button"
    :class="[variant, { large: size === 'large', block }]"
    :type="type"
    :disabled="disabled"
    :aria-label="label !== undefined && busy && busyLabel !== undefined ? busyLabel : label"
    :aria-disabled="inactive || busy ? true : undefined"
    :aria-busy="busy || undefined"
    @click="click"
  >
    <!-- An icon-only button draws its icon from the default slot; the label names it. -->
    <span v-if="variant === 'icon'" class="glyph" aria-hidden="true"><slot /></span>
    <template v-else>
      <span v-if="$slots.icon" class="glyph" aria-hidden="true"><slot name="icon" /></span>
      <!-- A block button is as wide as its place, so its word is swapped. Any other holds both words
           in one cell, the one not shown kept by its width: as wide as the wider word, it does not
           jump under the thumb when the work starts or ends. At rest the word of the work is drawn by
           CSS alone, so the button's text is its action's word — what a test or a copy reads. -->
      <span v-if="busyLabel !== undefined && !block" class="words">
        <span :class="{ unseen: busy }" :aria-hidden="busy || undefined"><slot /></span>
        <span v-if="busy">{{ busyLabel }}</span>
        <span v-else class="unseen" aria-hidden="true" :data-word="busyLabel" />
      </span>
      <template v-else-if="busy && busyLabel !== undefined">{{ busyLabel }}</template>
      <slot v-else />
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
 * **Busy is the button's own word** (MOL-225): `busyLabel` («Удаляем…») stands in place of the action's
 * for as long as it works, in the action's look — fill, ink and glyph stay, with `disabled` too, since
 * this is the one at work and not one that cannot be pressed. The word is the sign and the
 * explanation at once: no spinner (DESIGN.md), nothing that moves, and the name a screen reader reads
 * on the focused button along with `aria-busy`. The linter refuses a `busy` without it. A button named
 * by `label` — an icon-only one has no word to swap — takes the word of the work as its name.
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
    busyLabel: { type: String, default: undefined },
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

/* After every variant, so it wins over each of them. Busy is never not now, `disabled` or not
   (MOL-225): the button at work keeps its look and says so in its own word. */
.button:disabled:not([aria-busy='true']),
.button[aria-disabled='true']:not([aria-busy='true']) {
  background: var(--surface-2);
  color: var(--text-muted);
  font-weight: var(--weight-medium);
  cursor: not-allowed;
}

.button[aria-busy='true'] {
  cursor: progress;
}

/* The rest shadow is a live primary's. Light in weight (`:where`), so a place that lifts what it
   holds over the cards — the floating dock — keeps its lift on an inactive one (review 1). */
.primary:where(:disabled, [aria-disabled='true']):where(:not([aria-busy='true'])) {
  box-shadow: none;
}

.ghost:disabled:not([aria-busy='true']),
.danger-ghost:disabled:not([aria-busy='true']),
.ghost[aria-disabled='true']:not([aria-busy='true']),
.danger-ghost[aria-disabled='true']:not([aria-busy='true']) {
  background: transparent;
}

.secondary:disabled:not([aria-busy='true']),
.secondary[aria-disabled='true']:not([aria-busy='true']) {
  border-color: transparent;
}

/* In the middle both ways: the word not shown may wrap where a grid holds the button's width — «Готовим
   фото…» in a pair at 360 — and the cell grows two lines high; the word shown stays in the middle of
   it, not at its top (adversarial Р1-А4). */
.words {
  display: inline-grid;
  place-items: center;
  text-align: center;

  & > * {
    grid-area: 1 / 1;
  }
}

.unseen {
  visibility: hidden;
}

[data-word]::before {
  content: attr(data-word);
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
