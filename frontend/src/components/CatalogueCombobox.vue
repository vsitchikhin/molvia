<template>
  <div class="combobox">
    <div class="well">
      <IconMagnify class="glyph" aria-hidden="true" />
      <input
        ref="input"
        class="control"
        type="search"
        role="combobox"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="search"
        aria-autocomplete="list"
        :aria-label="label"
        :aria-describedby="`${id}-hint`"
        :aria-expanded="expanded ? 'true' : 'false'"
        :aria-controls="expanded ? `${id}-list` : undefined"
        :aria-activedescendant="active < 0 ? undefined : optionId(active)"
        :maxlength="maxLength"
        :placeholder="placeholder"
        :value="modelValue"
        @input="update"
        @keydown="onKeydown"
      />
    </div>
    <p :id="`${id}-hint`" class="hint">{{ hint }}</p>

    <slot name="before" />

    <template v-if="expanded">
      <p :id="`${id}-heading`" class="heading">{{ heading }}</p>
      <ul
        :id="`${id}-list`"
        ref="list"
        class="list"
        :class="{ stale }"
        role="listbox"
        :aria-labelledby="`${id}-heading`"
        :aria-busy="stale ? 'true' : undefined"
      >
        <li
          v-for="(item, index) in items"
          :id="optionId(index)"
          :key="item.id"
          class="row"
          :class="{ active: index === active }"
          role="option"
          :aria-selected="index === active ? 'true' : 'false'"
          @click="choose(item)"
        >
          <span class="text">
            <span class="name">{{ item.name }}</span>
            <span v-if="item.note" class="meta">{{ item.note }}</span>
          </span>
          <IconChevronRight class="glyph chevron" aria-hidden="true" />
        </li>
      </ul>
    </template>

    <slot name="after" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import IconChevronRight from '~icons/mdi/chevron-right'
import IconMagnify from '~icons/mdi/magnify'
import { CATALOGUE_QUERY_MAX } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'

/**
 * The field of «Что взяли?» and the list under it — an editable combobox by the ARIA 1.2
 * pattern, on a native input.
 *
 * Not Reka's combobox, though that was the plan (MOL-23, Р-1). Its content calls `hideOthers`
 * whenever it is shown, and this list is shown for as long as the screen is: the back chevron,
 * the title and the app's live region would be hidden from a screen reader the whole time. And
 * both its input and its listbox filter highlight the first row by themselves, so «Найти» on the
 * keyboard would take a row nobody chose.
 *
 * No row is active until an arrow makes one: Enter then takes it, and Enter with none hides the
 * keyboard instead — the search runs as the person types, and the first row is not always the
 * one (В-7). The list is in the page's flow and the page scrolls, never the list (MOL-17), so
 * the active row is brought into view by the page, to the nearest edge rather than the centre.
 *
 * Only what the server sent, in its order: nothing is filtered or sorted here.
 */
export default defineComponent({
  name: 'CatalogueCombobox',
  components: { IconChevronRight, IconMagnify },
  props: {
    modelValue: { type: String, required: true },
    items: { type: Array as PropType<CatalogueEntry[]>, required: true },
    /** «Часто берёте» or «Нашли» — what the list is, read out as its name. */
    heading: { type: String, required: true },
    /** The field's name for a screen reader: the screen's title, which is the question. */
    label: { type: String, required: true },
    placeholder: { type: String, required: true },
    hint: { type: String, required: true },
    /** The rows are the previous answer, and a newer search is out. */
    stale: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
    pick: (entry: CatalogueEntry) => typeof entry.id === 'string',
  },
  setup(props, { emit }) {
    const id = useId()
    const input = ref<HTMLInputElement | null>(null)
    const list = ref<HTMLUListElement | null>(null)
    const active = ref(-1)

    const expanded = computed(() => props.items.length > 0)

    function optionId(index: number): string {
      return `${id}-option-${String(index)}`
    }

    // A new list is a new question: the row made active in the old one means nothing in it.
    watch(
      () => props.items,
      () => {
        active.value = -1
      },
    )

    watch(active, async (index) => {
      if (index < 0) return
      await nextTick()
      list.value?.children[index]?.scrollIntoView({ block: 'nearest' })
    })

    function update(event: Event): void {
      emit('update:modelValue', (event.target as HTMLInputElement).value)
    }

    function choose(entry: CatalogueEntry): void {
      emit('pick', entry)
    }

    function onKeydown(event: KeyboardEvent): void {
      // A key that finishes a word in an input method belongs to that word, not to the list.
      if (event.isComposing) return
      const last = props.items.length - 1

      switch (event.key) {
        case 'ArrowDown':
          if (last < 0) return
          event.preventDefault()
          active.value = active.value >= last ? 0 : active.value + 1
          return
        case 'ArrowUp':
          if (last < 0) return
          event.preventDefault()
          active.value = active.value <= 0 ? last : active.value - 1
          return
        case 'Escape':
          active.value = -1
          return
        case 'Enter': {
          event.preventDefault()
          const entry = props.items[active.value]
          if (entry) choose(entry)
          else input.value?.blur()
          return
        }
      }
    }

    // The person came here to type. Whether iOS opens the keyboard for a focus outside a gesture
    // is for the phone to show (MOL-38); a hidden field on the previous screen to cheat it would
    // break with the next Safari.
    onMounted(() => {
      input.value?.focus({ preventScroll: true })
    })

    return {
      id,
      input,
      list,
      active,
      expanded,
      optionId,
      update,
      choose,
      onKeydown,
      maxLength: CATALOGUE_QUERY_MAX,
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
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--surface-2);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    outline-color var(--dur-fast) var(--ease-out);

  &:focus-within {
    border-color: var(--accent);
    outline: 2px solid var(--accent-tint);
  }
}

.glyph {
  /* 20 — the handoff's magnifier and row chevron */
  flex: none;
  width: 1.25rem;
  height: 1.25rem;
  color: var(--text-muted);
}

.control {
  flex: 1;
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
}

.hint {
  margin: 0;
  padding: var(--space-2) var(--space-4) 0;
  color: var(--text-muted);
  font-size: var(--text-caption);
}

.heading {
  margin: var(--space-6) 0 var(--space-2);
  padding: 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: var(--weight-bold);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
}

.list {
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
  border: var(--hairline) solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  transition: opacity var(--dur-fast) var(--ease-out);

  &.stale {
    opacity: var(--opacity-stale);
  }
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--touch-target);
  padding: var(--space-3) var(--space-4);
  cursor: pointer;

  & + & {
    border-top: var(--hairline) solid var(--border);
  }

  /* The keyboard's row, never :hover — a phone has none, and on a desktop it would fight the
     arrows for which row is active. */
  &.active {
    background: var(--accent-tint);

    .name {
      font-weight: var(--weight-bold);
    }
  }
}

.text {
  flex: 1;
  min-width: 0;
}

.name {
  display: block;
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  line-height: var(--leading-snug);
}

.meta {
  display: block;
  color: var(--text-muted);
  font-size: var(--text-footnote);
}

@media (prefers-reduced-motion: reduce) {
  .well,
  .list {
    transition: none;
  }
}
</style>
