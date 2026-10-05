<template>
  <div class="combobox">
    <SearchField
      ref="field"
      :model-value="modelValue"
      :label="label"
      :placeholder="placeholder"
      :hint="hint"
      :maxlength="maxLength"
      :readonly="readonly"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="expanded ? 'true' : 'false'"
      :aria-controls="expanded ? `${id}-list` : undefined"
      :aria-activedescendant="active < 0 ? undefined : optionId(active)"
      @update:model-value="$emit('update:modelValue', $event)"
      @keydown="onKeydown"
    >
      <!-- An action beside the text — the scanner (MOL-99) — inside the field, outside the input. -->
      <template v-if="$slots.trailing" #trailing><slot name="trailing" /></template>
    </SearchField>

    <slot name="before" />

    <template v-if="expanded">
      <SectionCaption :id="`${id}-heading`" as="p" class="heading">{{ heading }}</SectionCaption>
      <AppCard
        :id="`${id}-list`"
        ref="list"
        as="ul"
        list
        class="options"
        :class="{ stale }"
        role="listbox"
        :aria-labelledby="`${id}-heading`"
        :aria-busy="stale ? 'true' : undefined"
      >
        <ListRow
          v-for="(item, index) in items"
          :id="optionId(index)"
          :key="item.id"
          as="li"
          class="row"
          role="option"
          :title="item.name"
          :meta="item.note ?? ''"
          :active="index === active"
          next
          @click="choose(item)"
        />
      </AppCard>
    </template>

    <slot name="after" />
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, onMounted, ref, useId, watch } from 'vue'
import type { PropType } from 'vue'
import { CATALOGUE_QUERY_MAX } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import ListRow from '@/components/ListRow.vue'
import SearchField from '@/components/SearchField.vue'
import SectionCaption from '@/components/SectionCaption.vue'

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
 *
 * The field is the kit's `SearchField`, given the combobox's role, `aria-*` and keys; a row is a
 * `ListRow` option, the one the arrows stand on filled and its weight unchanged (MOL-177, К-4).
 */
export default defineComponent({
  name: 'CatalogueCombobox',
  components: { AppCard, ListRow, SearchField, SectionCaption },
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
    /** Nothing may be typed now — a code on its way to an item waits for its answer (MOL-100). */
    readonly: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
    pick: (entry: CatalogueEntry) => typeof entry.id === 'string',
  },
  setup(props, { emit, expose }) {
    const id = useId()
    const field = ref<{ focus: (options?: FocusOptions) => void; blur: () => void } | null>(null)
    const list = ref<{ $el: HTMLElement } | null>(null)
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
      list.value?.$el.children[index]?.scrollIntoView({ block: 'nearest' })
    })

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
          // With a row active, Esc lets go of the row only: a search field clears itself on Esc
          // in Chrome and Safari, and the query would go with it. With none, the field is cleared
          // the platform's way.
          if (active.value < 0) return
          event.preventDefault()
          active.value = -1
          return
        case 'Enter': {
          event.preventDefault()
          const entry = props.items[active.value]
          if (entry) choose(entry)
          else field.value?.blur()
          return
        }
      }
    }

    // The person came here to type. Whether iOS opens the keyboard for a focus outside a gesture
    // is for the phone to show (MOL-38); a hidden field on the previous screen to cheat it would
    // break with the next Safari.
    onMounted(() => {
      field.value?.focus({ preventScroll: true })
    })

    function focus(options?: FocusOptions): void {
      field.value?.focus(options)
    }

    expose({ focus })

    return {
      focus,
      id,
      field,
      list,
      active,
      expanded,
      optionId,
      choose,
      onKeydown,
      maxLength: CATALOGUE_QUERY_MAX,
    }
  },
})
</script>

<style scoped lang="scss">
.heading {
  margin-top: var(--space-6);
}

.options {
  transition: opacity var(--dur-fast) var(--ease-out);

  &.stale {
    opacity: var(--opacity-stale);
  }
}

/* The page scrolls the active row into view, and the pinned bar of a nested screen covers the top of
   it: moving up, the row would stop right under the bar (Р-8). */
.row {
  scroll-margin-top: calc(var(--bar-height) + var(--safe-top) + var(--space-2));
}

@media (prefers-reduced-motion: reduce) {
  .options {
    transition: none;
  }
}
</style>
