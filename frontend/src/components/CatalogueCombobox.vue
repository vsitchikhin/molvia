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

    <!-- One listbox whatever the groups (MOL-209): the arrows walk every row of them as one run, and
         `aria-activedescendant` knows no edge of a group. A group is named by its caption. -->
    <div
      v-if="expanded"
      :id="`${id}-list`"
      class="groups"
      :class="{ stale }"
      role="listbox"
      :aria-label="label"
      :aria-busy="stale ? 'true' : undefined"
    >
      <div
        v-for="group in shown"
        :key="group.key"
        class="group"
        role="group"
        :aria-labelledby="`${id}-${group.key}-heading`"
      >
        <SectionCaption :id="`${id}-${group.key}-heading`" as="p" class="heading">
          {{ group.heading }}
        </SectionCaption>
        <!-- `none`: a list between the group and its options would break what owns them. -->
        <AppCard as="ul" list class="options" role="none">
          <ListRow
            v-for="(item, index) in group.items"
            :id="optionId(group.from + index)"
            :key="item.id"
            as="li"
            class="row"
            role="option"
            :title="item.name"
            :meta="item.note ?? ''"
            :active="group.from + index === active"
            wrap
            next
            @click="choose(item)"
          />
        </AppCard>
      </div>
    </div>

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
 * Only what the screen gives, in its order: nothing is filtered or sorted here. The rows come in
 * groups, each under its caption, all of them one listbox (MOL-209): a group with no rows is not
 * drawn, and with no rows at all there is no list.
 *
 * The field is the kit's `SearchField`, given the combobox's role, `aria-*` and keys; a row is a
 * `ListRow` option, the one the arrows stand on filled and its weight unchanged (MOL-177, К-4).
 */
/** A run of rows under one caption: «Брали здесь в прошлый раз», «Часто берёте», «Нашли». */
export interface ComboboxGroup {
  /** Stable across answers and unique in the list: it names the caption the group is read by. */
  readonly key: string
  readonly heading: string
  readonly items: readonly CatalogueEntry[]
}

export default defineComponent({
  name: 'CatalogueCombobox',
  components: { AppCard, ListRow, SearchField, SectionCaption },
  props: {
    modelValue: { type: String, required: true },
    /** «Брали здесь в прошлый раз» and «Часто берёте», or «Нашли» — each read out as its name. */
    groups: { type: Array as PropType<readonly ComboboxGroup[]>, required: true },
    /** The field's name for a screen reader, and the list's: the screen's title, the question. */
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
    const active = ref(-1)

    // Each group knows where its rows start in the one run the arrows walk.
    const shown = computed(() => {
      let from = 0
      return props.groups
        .filter((group) => group.items.length > 0)
        .map((group) => {
          const at = from
          from += group.items.length
          return { ...group, from: at }
        })
    })
    const rows = computed(() => shown.value.flatMap((group) => group.items))
    const expanded = computed(() => rows.value.length > 0)

    function optionId(index: number): string {
      return `${id}-option-${String(index)}`
    }

    // A new list is a new question: the row made active in the old one means nothing in it. Told by
    // its rows and the query, never by the array: the screen builds its groups anew whenever the
    // record it writes into is read again, with the very same rows (MOL-209, adversarial А3).
    watch([() => rows.value.map((row) => row.id).join(), () => props.modelValue], () => {
      active.value = -1
    })

    // By the row's id, not its place among the list's children: the rows are in groups now.
    watch(active, async (index) => {
      if (index < 0) return
      await nextTick()
      document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' })
    })

    function choose(entry: CatalogueEntry): void {
      emit('pick', entry)
    }

    function onKeydown(event: KeyboardEvent): void {
      // A key that finishes a word in an input method belongs to that word, not to the list.
      if (event.isComposing) return
      const last = rows.value.length - 1

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
          const entry = rows.value[active.value]
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
      active,
      shown,
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

.groups {
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
  .groups {
    transition: none;
  }
}
</style>
