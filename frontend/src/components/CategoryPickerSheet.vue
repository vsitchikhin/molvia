<template>
  <BottomSheet :open="open" back @update:open="$emit('update:open', $event)">
    <template #title>{{ t('spending.sheet.more_title') }}</template>

    <div class="list" role="radiogroup" :aria-label="t('spending.sheet.more_title')">
      <AppCard as="ul" list>
        <li v-for="category in categories" :key="category.id">
          <ListRow
            role="radio"
            :title="nameOf(category)"
            :dot="colourOf(category)"
            :selected="selected === category.id"
            @click="pick(category.id)"
          />
        </li>
        <li>
          <ListRow aria-haspopup="dialog" @click="$emit('add')">
            <template #title>
              <span class="add"
                ><IconPlus class="plus" aria-hidden="true" />{{
                  t('spending.sheet.add_category')
                }}</span
              >
            </template>
          </ListRow>
        </li>
      </AppCard>
    </div>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconPlus from '~icons/mdi/plus'
import type { SpendingCategoryView } from '@molvia/model'
import AppCard from '@/components/AppCard.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ListRow from '@/components/ListRow.vue'
import { categoryColour } from '@/components/spending'

/**
 * «Категория» — every category a spending may take, over its sheet (MOL-198, handoff 72 v2, «Ещё…»):
 * the chips hold two rows of the frequent ones, this list holds all, in the same order. A row is the
 * kit's, its dot the category's colour (owner's В-3 «а»); a choice closes the list — there is nothing
 * to confirm. The last row makes one's own (В-1 of MOL-82): «Новая категория» over this list, and
 * made, it is chosen and both go (owner's В-1 «а»).
 */
export default defineComponent({
  name: 'CategoryPickerSheet',
  components: { AppCard, BottomSheet, IconPlus, ListRow },
  props: {
    open: { type: Boolean, required: true },
    /** In the order of the chips. */
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    nameOf: {
      type: Function as PropType<(category: SpendingCategoryView) => string>,
      required: true,
    },
    selected: { type: String as PropType<string | null>, default: null },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    pick: (id: string) => typeof id === 'string',
    add: () => true,
  },
  setup(_props, { emit }) {
    const { t } = useI18n()
    function pick(id: string): void {
      emit('pick', id)
      emit('update:open', false)
    }
    return { t, pick, colourOf: categoryColour }
  },
})
</script>

<style scoped lang="scss">
.list {
  margin-top: var(--space-2);
}

/* The one row that makes rather than chooses: «press here», the accent's ink. */
.add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--accent-ink);
}

.plus {
  @include icon;

  font-size: var(--icon-sm);
}
</style>
