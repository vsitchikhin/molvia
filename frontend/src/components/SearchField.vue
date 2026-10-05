<template>
  <div class="search-field" v-bind="rootAttrs()">
    <div class="well" :class="{ trailed }">
      <IconMagnify class="glyph" aria-hidden="true" />
      <input
        ref="input"
        class="control"
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        :aria-label="label"
        :aria-describedby="hint ? hintId : undefined"
        :maxlength="maxlength"
        :placeholder="placeholder"
        :readonly="readonly"
        :value="modelValue"
        v-bind="inputAttrs()"
        @input="type"
        @keydown="escape"
      />
      <!-- The screen's action — the scanner (MOL-99) — or the field's own «Очистить»: never both. -->
      <slot name="trailing">
        <button
          v-if="clearable && modelValue && !readonly"
          class="clear"
          type="button"
          :aria-label="t('field.clear')"
          @click="clear"
        >
          <IconCloseCircle class="glyph" aria-hidden="true" />
        </button>
      </slot>
    </div>
    <p v-if="hint" :id="hintId" class="hint">{{ hint }}</p>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCloseCircle from '~icons/mdi/close-circle'
import IconMagnify from '~icons/mdi/magnify'

/**
 * Whether the platform closes this dialog on Esc, in its own words: `closedBy` is the state it worked
 * out — `none` for a dialog beside the page or one marked to be stepped through, `closerequest` or `any`
 * otherwise, whatever the attribute says (round 4, Г1: a dialog beside the page marked `closerequest`
 * closes too). An engine without it knows no `closedby` and closes a modal dialog alone.
 */
function closedBy(dialog: HTMLDialogElement): string {
  // Typed as always there, and an engine before it has not got it.
  const answer: unknown = Reflect.get(dialog, 'closedBy')
  if (typeof answer === 'string') return answer
  return dialog.matches(':modal') ? 'closerequest' : 'none'
}

/**
 * Whether a popover is open. The platform's Esc closes the topmost of what closes, and an open popover
 * stands above the dialog: taken by the field, Esc closed the dialog under it (round 5, Д1). Which one is
 * on top no script can ask, so with any popover open the key stays the platform's. Only one Esc closes:
 * `manual` is a strip that stays until taken away, and counted it gave Esc back to Chromium's clearing
 * under every such strip (round 6, Е1). An engine that knows no `:popover-open` has none open.
 */
function popoverOpen(): boolean {
  try {
    return [...document.querySelectorAll<HTMLElement>('[popover]')].some(
      (one) => one.popover !== 'manual' && one.matches(':popover-open'),
    )
  } catch {
    return false
  }
}

/**
 * The one search field of the app (Ф-12, MOL-177): a pill on `surface-2` with the edge of a field,
 * a magnifier at the left, the screen's action or «Очистить» at the right, a hint under it.
 *
 * Only the field. Whether it owns a list is its owner's business: a combobox gives it its role,
 * its `aria-*` and its keys, and they land on the `<input>` — every attribute but `class` and
 * `style`, which stay on the field as a whole. So «Что взяли?», «Что брать» and «Выбрать товар»
 * look alike without the two simple searches carrying a listbox they have not got.
 *
 * `type="search"`: a search field clears itself on Esc in Chrome and Safari, which the combobox
 * leaves to the platform when no row is active.
 */
export default defineComponent({
  name: 'SearchField',
  components: { IconCloseCircle, IconMagnify },
  inheritAttrs: false,
  props: {
    modelValue: { type: String, required: true },
    /** The field's name for a screen reader — the screen says the rest with its title. */
    label: { type: String, required: true },
    placeholder: { type: String, default: '' },
    hint: { type: String, default: '' },
    /** «Очистить» while there is text — unless the slot `trailing` holds the screen's own action, or
     *  nothing may be changed now (`readonly`). */
    clearable: { type: Boolean, default: false },
    maxlength: { type: Number, default: undefined },
    readonly: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
  },
  setup(props, { attrs, emit, expose, slots }) {
    const { t } = useI18n()
    const hintId = `${useId()}-hint`
    const input = ref<HTMLInputElement | null>(null)

    const trailed = computed(
      () => !!slots.trailing || (props.clearable && props.modelValue !== '' && !props.readonly),
    )

    function focus(options?: FocusOptions): void {
      input.value?.focus(options)
    }

    function blur(): void {
      input.value?.blur()
    }

    expose({ focus, blur })

    return {
      focus,
      blur,
      t,
      hintId,
      input,
      trailed,
      // Read at render: the attributes of a component are not reactive, but a change of them renders it.
      rootAttrs: () => ({ class: attrs.class, style: attrs.style }),
      inputAttrs: () =>
        Object.fromEntries(
          Object.entries(attrs).filter(([key]) => key !== 'class' && key !== 'style'),
        ),
      // In a dialog Esc closes it — in a sheet that is «back» (MOL-80). Chromium gives a search field's
      // Esc to the field instead — it clears the text and the dialog never hears `cancel` — so «Выбрать
      // товар» lost the receipt's words and stayed open (adversarial А3). Taken here, the text stays and
      // the dialog gets the close request the platform would have made: a `cancel` it may prevent — a
      // sheet does, and closes through the history — else it is closed (round 2, Б1: a `cancel` from a
      // script closes nothing by itself). Only where the platform makes one, by its own answer (round 3,
      // В1; round 4, Г1). Its owner's own Esc — a combobox's — comes first.
      escape: (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
        const dialog = input.value?.closest('dialog')
        if (!dialog?.open || closedBy(dialog) === 'none' || popoverOpen()) return
        event.preventDefault()
        if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close()
      },
      type: (event: Event) => {
        emit('update:modelValue', (event.target as HTMLInputElement).value)
      },
      // Back into the field: the button goes with what it cleared, and the focus would be left on
      // nothing — the keyboard folded, a screen reader thrown to the top (MOL-128, review Р-12).
      clear: () => {
        emit('update:modelValue', '')
        focus()
      },
    }
  },
})
</script>

<style scoped lang="scss">
.well {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--touch-target);
  padding: 0 var(--space-4);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    outline-color var(--dur-fast) var(--ease-out);

  &:focus-within {
    @include field-focus;
  }

  /* The button at the end is a touch target of its own: it sits at the pill's end, not inset. */
  &.trailed {
    padding-right: 0;
  }
}

.glyph {
  @include icon;

  font-size: var(--icon);
  color: var(--text-muted);
}

.control {
  flex: 1;

  /* No width of its own: an input brings some twenty characters as its least width, and in a grid
     or under a flex item with no `min-width: 0` that pushed the page wider than a phone of 320. */
  width: 0;
  min-width: 0;
  min-height: var(--touch-target);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--text-body);
  appearance: none;

  /* The ring is drawn on the well. */
  outline: none;

  &::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }

  /* Chrome draws its clear button in the system blue, past the tokens. */
  &::-webkit-search-cancel-button {
    appearance: none;
  }
}

.clear {
  @include touch-target;

  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring(-2px);
  }
}

.hint {
  margin: 0;
  padding: var(--space-2) var(--space-4) 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

@media (prefers-reduced-motion: reduce) {
  .well {
    transition: none;
  }
}
</style>
