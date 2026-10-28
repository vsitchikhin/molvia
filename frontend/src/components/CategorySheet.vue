<template>
  <BottomSheet ref="sheet" :open="open" :back="over" @update:open="$emit('update:open', $event)">
    <template #title>{{
      category ? t('spending.new_category.edit_title') : t('spending.new_category.title')
    }}</template>
    <form class="form" novalidate @submit.prevent="submit">
      <AppField
        ref="field"
        v-model="name"
        :label="t('spending.new_category.name')"
        :placeholder="t('spending.new_category.placeholder')"
        :maxlength="nameMax"
        :error-text="problem"
        enterkeyhint="done"
        autocomplete="off"
        @update:model-value="problem = null"
      />

      <fieldset class="choice">
        <legend class="legend">{{ t('spending.new_category.colour') }}</legend>
        <div class="options colours">
          <label v-for="n in colours" :key="n" class="option" :class="{ on: n === colour }">
            <input
              class="radio"
              type="radio"
              :name="colourGroup"
              :value="n"
              :checked="n === colour"
              :aria-label="
                t('spending.new_category.colour_label', { n: n + 1, total: colours.length })
              "
              @change="choose(n)"
              @click="choose(n)"
            />
            <span class="swatch" :style="{ background: `var(--cat-own-${n})` }" aria-hidden="true"
              ><IconCheck v-if="n === colour" class="tick"
            /></span>
          </label>
        </div>
      </fieldset>
      <fieldset class="choice">
        <legend class="legend">{{ t('spending.new_category.icon') }}</legend>
        <div class="options">
          <label v-for="key in icons" :key="key" class="option" :class="{ on: key === icon }">
            <input
              class="radio"
              type="radio"
              :name="iconGroup"
              :value="key"
              :checked="key === icon"
              :aria-label="iconLabel(key)"
              @change="icon = key"
            />
            <span class="circle" :style="circleStyle" aria-hidden="true"
              ><component :is="iconOf(key)" class="glyph"
            /></span>
          </label>
        </div>
      </fieldset>
    </form>
    <template #footer>
      <AppButton size="large" block @click="submit">
        <template #icon><IconCheck /></template>
        {{ category ? t('spending.new_category.edit_save') : t('spending.new_category.save') }}
      </AppButton>
      <AppButton v-if="category" variant="ghost" block @click="remove">
        {{ t('spending.new_category.remove') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, nextTick, ref, useId, watch } from 'vue'
import type { ComponentPublicInstance, PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import {
  DEFAULT_SPENDING_ICON,
  SPENDING_CATEGORY_COLOURS,
  SPENDING_CATEGORY_NAME_MAX,
  SPENDING_ICONS,
  SPENDING_PRESETS,
  nameIdentity,
  nextCategoryColour,
  spendingCategoryNameSchema,
} from '@molvia/model'
import type { SpendingCategoryView, SpendingIcon, SpendingPreset } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { OWN_ICONS } from '@/components/spending'
import { newId } from '@/ids'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const PRESET_KEYS: readonly string[] = SPENDING_PRESETS

/**
 * «Новая категория» (MOL-82, В-1) and the sheet of one's own (MOL-285, В-1 «а»): a name, an icon of
 * the set and a colour of the palette — the colour first, since thirty-seven icons go on below the
 * fold and the colour is what tells one's own apart on the ring — through the queue, so a category named at the till with no
 * signal is there for the spending at once (В-4). A new one starts on the tag and the palette's next,
 * so at the shelf it is still a name and «Добавить» (Р-4). Opened on one's own, the same sheet amends
 * it whole, and «Убрать категорию» stands under «Сохранить» — quiet, since it erases nothing (В-2 «а»).
 *
 * A name equal to a preset in the language of the screen — «Продукты» beside the groceries — is
 * refused here: the server keeps presets by key and does not know the language of the chips
 * (MOL-73, Д7). A live one of one's own is refused too, by the server's own identity of names.
 */
export default defineComponent({
  name: 'CategorySheet',
  components: { AppButton, AppField, BottomSheet, IconCheck },
  props: {
    open: { type: Boolean, required: true },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    /** One's own to amend; none makes a new one. */
    category: { type: Object as PropType<SpendingCategoryView | null>, default: null },
    /** Opened over the sheet of a spending: «‹» back to it, no × (MOL-123, В-4). */
    over: { type: Boolean, default: false },
    /**
     * How many sheets a new one closes on «Добавить»: opened from the list «Ещё…» of a spending, the
     * list goes with it and the spending stands with its new category chosen (MOL-198, owner's В-1 «а»).
     */
    closes: { type: Number, default: 1 },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    created: (id: string) => typeof id === 'string',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const queue = useSpendingQueueStore()
    const sheet = ref<{ close: (steps?: number) => void } | null>(null)
    const name = ref('')
    const icon = ref<SpendingIcon>(DEFAULT_SPENDING_ICON)
    const colour = ref(0)
    /** Whether the person touched the colour — a colour pressed is theirs, the next only a guess. */
    const colourChosen = ref(false)
    const problem = ref<string | null>(null)
    const field = ref<ComponentPublicInstance | null>(null)

    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        const own = props.category
        name.value = own?.name ?? ''
        icon.value = own?.icon ?? DEFAULT_SPENDING_ICON
        colour.value = own?.colour ?? nextCategoryColour(props.categories)
        colourChosen.value = false
        problem.value = null
        // A new one is a name to type; one's own opened to amend may be only a new icon, and the
        // keyboard would cover the choice.
        if (own) return
        await nextTick()
        ;(field.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus()
      },
    )

    function taken(typed: string): boolean {
      const identity = nameIdentity(typed)
      const presets = SPENDING_PRESETS.map((preset) => t(`spending.category.${preset}`))
      const own = props.categories.flatMap((category) =>
        category.preset === null &&
        !category.archived &&
        category.id !== props.category?.id &&
        category.name
          ? [category.name]
          : [],
      )
      return [...presets, ...own].some((existing) => nameIdentity(existing) === identity)
    }

    function close(): void {
      emit('update:open', false)
    }

    function submit(): void {
      if (!name.value.trim()) {
        problem.value = t('spending.new_category.bad_empty')
        return
      }
      const checked = spendingCategoryNameSchema.safeParse(name.value)
      if (!checked.success) {
        problem.value = t('spending.sheet.bad_text')
        return
      }
      const own = props.category
      // A name kept as it was is the server's already: a preset's name in the language of this screen
      // is no reason to refuse a new icon to one made on a screen in another (adversarial А2).
      const kept = own?.name != null && nameIdentity(own.name) === nameIdentity(checked.data)
      if (!kept && taken(checked.data)) {
        problem.value = t('spending.new_category.bad_taken')
        return
      }
      const body = { name: checked.data, icon: icon.value, colour: colour.value }
      if (own) {
        const same = own.name === body.name && own.icon === body.icon && own.colour === body.colour
        if (!same) queue.amendCategory(own.id, body, kept)
        close()
        return
      }
      const id = newId()
      // The tag and a colour nobody touched go unnamed, as an earlier build sends them: such a body reads
      // in an image rolled back past MOL-285, and the server's next is the rule (adversarial А3). A colour
      // pressed goes named even when it is the phone's next: the server's may differ, and the person
      // chose this one (review №6, adversarial Б1).
      queue.addCategory({
        id,
        name: body.name,
        ...(body.icon === DEFAULT_SPENDING_ICON ? {} : { icon: body.icon }),
        ...(colourChosen.value ? { colour: body.colour } : {}),
      })
      emit('created', id)
      if (props.closes > 1) sheet.value?.close(props.closes)
      else close()
    }

    function choose(n: number): void {
      colour.value = n
      colourChosen.value = true
    }

    function remove(): void {
      if (props.category) queue.archiveCategory(props.category.id, true)
      close()
    }

    const iconLabel = (key: SpendingIcon) =>
      PRESET_KEYS.includes(key)
        ? t(`spending.category.${key as SpendingPreset}`)
        : t(`spending.icon.${key}`)

    return {
      t,
      sheet,
      name,
      icon,
      colour,
      problem,
      field,
      nameMax: SPENDING_CATEGORY_NAME_MAX,
      icons: SPENDING_ICONS,
      colours: Array.from({ length: SPENDING_CATEGORY_COLOURS }, (_, n) => n),
      // As the row will draw it (`ListRow`'s circle): the colour chosen on its tint.
      circleStyle: computed(() => {
        const tint = `var(--cat-own-${String(colour.value)})`
        return {
          color: tint,
          background: `color-mix(in oklch, ${tint} var(--cat-tint-share), var(--surface))`,
        }
      }),
      iconGroup: useId(),
      colourGroup: useId(),
      iconOf: (key: SpendingIcon) => OWN_ICONS[key],
      iconLabel,
      submit,
      choose,
      remove,
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding: var(--space-4);
}

.choice {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.legend {
  margin-bottom: var(--space-2);
  padding: 0;
  color: var(--text-muted);
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

/* Each the thumb's 44, the row spaced out to the form's edges — five icons to a row at 320, six at
   390 (the sheet's 16 and the form's own, as the spending's sheet). Rows 8 apart, so the focus
   standing off the ring of one does not touch the next. */
.options {
  display: grid;
  grid-template-columns: repeat(auto-fill, var(--touch-target));
  justify-content: space-between;
  gap: var(--space-2) var(--space-1);
}

/* The eight colours four and four on every phone: by the width they broke five and three at 320,
   six and two at 390, seven and one at 430 (review №1). */
.colours {
  grid-template-columns: repeat(4, var(--touch-target));
}

.option {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--touch-target);
  height: var(--touch-target);
  border-radius: var(--radius-pill);
  cursor: pointer;

  /* Off the ring with the sheet's ground between them: the focus of a radio group stands on the one
     chosen, and on the ring's own place it was the ring a little thicker (review №4, WCAG 2.4.7) —
     the chips' way, the ring inside and the focus outside. */
  &:has(.radio:focus-visible) {
    @include focus-ring(4px);
  }
}

.radio {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

/* An icon as the row will draw it: in the colour chosen, on its tint. Chosen is a form — a ring of
   the accent around it, standing off by the sheet's own ground (MOL-179). */
.circle {
  display: grid;
  place-items: center;
  width: var(--row-circle);
  height: var(--row-circle);
  border-radius: var(--radius-pill);
}

.glyph {
  @include icon;

  font-size: var(--icon-md);
}

.swatch {
  display: grid;
  place-items: center;
  width: var(--row-circle);
  height: var(--row-circle);
  border-radius: var(--radius-pill);
}

.tick {
  @include icon;

  font-size: var(--icon-md);
  color: var(--surface);
}

.on .circle,
.on .swatch {
  box-shadow:
    0 0 0 2px var(--surface),
    0 0 0 4px var(--accent);
}
</style>
