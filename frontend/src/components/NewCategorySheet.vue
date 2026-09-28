<template>
  <BottomSheet :open="open" :back="over" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('spending.new_category.title') }}</template>
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
    </form>
    <template #footer>
      <AppButton size="large" block @click="submit">
        <template #icon><IconCheck /></template>
        {{ t('spending.new_category.save') }}
      </AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent, nextTick, ref, watch } from 'vue'
import type { ComponentPublicInstance, PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/mdi/check'
import {
  SPENDING_CATEGORY_NAME_MAX,
  SPENDING_PRESETS,
  nameIdentity,
  spendingCategoryNameSchema,
} from '@molvia/model'
import type { SpendingCategoryView } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { newId } from '@/ids'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

/**
 * «Новая категория» (MOL-82, В-1): a name, and it is made — through the queue, so a category
 * named at the till with no signal is there for the spending at once (В-4). The colour is the
 * palette's next; choosing one is not asked for.
 *
 * A name equal to a preset in the language of the screen — «Продукты» beside the groceries — is
 * refused here: the server keeps presets by key and does not know the language of the chips
 * (MOL-73, Д7). A live one of one's own is refused too, by the server's own identity of names.
 */
export default defineComponent({
  name: 'NewCategorySheet',
  components: { AppButton, AppField, BottomSheet, IconCheck },
  props: {
    open: { type: Boolean, required: true },
    categories: { type: Array as PropType<SpendingCategoryView[]>, required: true },
    /** Opened over the sheet of a spending: «‹» back to it, no × (MOL-123, В-4). */
    over: { type: Boolean, default: false },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    created: (id: string) => typeof id === 'string',
  },
  setup(props, { emit }) {
    const { t } = useI18n()
    const queue = useSpendingQueueStore()
    const name = ref('')
    const problem = ref<string | null>(null)
    const field = ref<ComponentPublicInstance | null>(null)

    watch(
      () => props.open,
      async (open) => {
        if (!open) return
        name.value = ''
        problem.value = null
        await nextTick()
        ;(field.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus()
      },
    )

    function taken(typed: string): boolean {
      const identity = nameIdentity(typed)
      const presets = SPENDING_PRESETS.map((preset) => t(`spending.category.${preset}`))
      const own = props.categories.flatMap((category) =>
        category.preset === null && !category.archived && category.name ? [category.name] : [],
      )
      return [...presets, ...own].some((existing) => nameIdentity(existing) === identity)
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
      if (taken(checked.data)) {
        problem.value = t('spending.new_category.bad_taken')
        return
      }
      const id = newId()
      queue.addCategory({ id, name: checked.data })
      emit('created', id)
      emit('update:open', false)
    }

    return { t, name, problem, field, nameMax: SPENDING_CATEGORY_NAME_MAX, submit }
  },
})
</script>

<style scoped lang="scss">
.form {
  padding: var(--space-4);
}
</style>
