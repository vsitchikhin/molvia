<template>
  <NavRow
    field
    :label="t('spending.sheet.category')"
    :value="name"
    v-bind="icon ? { icon } : {}"
    :aria-disabled="disabled ? 'true' : undefined"
    @click="!disabled && (open = true)"
  />
  <CategoryPickerSheet
    v-model:open="open"
    :categories="choice"
    :name-of="nameOf"
    :selected="shown?.id ?? null"
    :addable="false"
    @pick="$emit('pick', $event)"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { TRIP_CATEGORY } from '@molvia/model'
import type { SpendingCategoryView } from '@molvia/model'
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import NavRow from '@/components/NavRow.vue'
import { categoryIcon, chipOrder } from '@/components/spending'

/**
 * «Категория ›» of a trip (MOL-400, owner's В-3 «а»): the category «Деньги» count the purchases in, on the
 * receipt's review, in «Закончить» and in the summary of «Траты» — the field's well, as «Счёт ›» under it. It
 * opens the list of «Категория» (MOL-198) in the chips' order, with no «+ Своя»: a category made here goes
 * through the spendings' queue and the trip through its own, and the trip could land first and name a
 * category the server does not have yet — «Продукты». One's own is made in «Категории».
 *
 * A trip with no category is «Продукты», as the server counts it (handoff 06).
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
    const shown = computed(
      () =>
        props.categories.find((category) => category.id === props.selected) ??
        props.categories.find((category) => category.preset === TRIP_CATEGORY) ??
        null,
    )
    // the live ones, and the trip's own where it was taken out of the choice since
    const choice = computed(() =>
      chipOrder(
        props.categories.filter(
          (category) => !category.archived || category.id === shown.value?.id,
        ),
        props.frequent,
      ),
    )
    const name = computed(() =>
      shown.value ? props.nameOf(shown.value) : t(`spending.category.${TRIP_CATEGORY}`),
    )
    const icon = computed(() => (shown.value ? categoryIcon(shown.value) : undefined))
    return { t, open, shown, choice, name, icon }
  },
})
</script>
