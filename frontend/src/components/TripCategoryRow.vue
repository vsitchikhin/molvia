<template>
  <NavRow
    field
    :label="t('spending.sheet.category')"
    :value="name"
    v-bind="icon ? { icon } : {}"
    :inactive="disabled"
    @click="open = true"
  />
  <!-- Out of the sheet the row may stand in («Закончить», the summary of «Траты»): a `<dialog>` inside another
       one is two titles in the open sheet for a reader and a test alike (CI, `large-text.spec`). -->
  <Teleport to="body">
    <CategoryPickerSheet
      v-model:open="open"
      :categories="choice"
      :name-of="nameOf"
      :selected="shown?.id ?? null"
      :addable="false"
      @pick="$emit('pick', $event)"
    />
  </Teleport>
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { TRIP_CATEGORY } from '@molvia/model'
import type { SpendingCategoryView } from '@molvia/model'
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import NavRow from '@/components/NavRow.vue'
import { categoryIcon, chipOrder, tripIcon } from '@/components/spending'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

/**
 * «Категория ›» of a trip (MOL-400, owner's В-3 «а»): the category «Деньги» count the purchases in, on the
 * receipt's review, in «Закончить» and in the summary of «Траты» — the field's well, as «Счёт ›» under it. It
 * opens the list of «Категория» (MOL-198) in the chips' order, with no «+ Своя» and **no category still waiting
 * in the spendings' queue** (adversarial А1): the trip goes through a queue of its own, could land first and name
 * a category the server has not got yet, which the server takes as no word at all. One made in «Категории» is
 * offered here once it has landed.
 *
 * A trip with no category is «Продукты», as the server counts it (handoff 06). One whose category the list lacks is
 * not known (MOL-406, adversarial Р3-В1): the cart and the word of the row it was opened from, nothing chosen in the
 * list — «Продукты» chosen there was a word about the person's choice the phone does not have, and a tap on it to
 * «leave it» wrote «Продукты» over the trip's own.
 */
export default defineComponent({
  name: 'TripCategoryRow',
  components: { CategoryPickerSheet, NavRow },
  props: {
    /** Every category of the owner's, the removed ones too: a trip may stand in one. */
    categories: { type: Array as PropType<readonly SpendingCategoryView[]>, required: true },
    frequent: { type: Array as PropType<readonly string[]>, default: () => [] },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    selected: { type: String as PropType<string | null>, default: null },
    disabled: { type: Boolean, default: false },
  },
  emits: { pick: (id: string) => typeof id === 'string' },
  setup(props) {
    const { t } = useI18n()
    const open = ref(false)
    const spendings = useSpendingQueueStore()
    /** `null` — «Продукты» not in the list; `undefined` — a category named the list lacks: not known. */
    const shown = computed(() =>
      props.selected === null
        ? (props.categories.find((category) => category.preset === TRIP_CATEGORY) ?? null)
        : props.categories.find((category) => category.id === props.selected),
    )
    // the live ones the server has, and the trip's own where it was taken out of the choice since
    const waiting = computed(
      () =>
        new Set(
          spendings.pending.flatMap((write) =>
            write.kind === 'category-add' ? [write.body.id] : [],
          ),
        ),
    )
    const choice = computed(() =>
      chipOrder(
        props.categories.filter(
          (category) =>
            category.id === shown.value?.id ||
            (!category.archived && !waiting.value.has(category.id)),
        ),
        props.frequent,
      ),
    )
    const name = computed(() => {
      if (shown.value) return props.nameOf(shown.value)
      return shown.value === null
        ? t(`spending.category.${TRIP_CATEGORY}`)
        : t('spending.category.other')
    })
    const icon = computed(() => {
      if (shown.value) return categoryIcon(shown.value)
      return shown.value === null ? undefined : tripIcon
    })
    return { t, open, shown, choice, name, icon }
  },
})
</script>
