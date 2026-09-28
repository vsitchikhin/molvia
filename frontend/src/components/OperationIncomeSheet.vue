<template>
  <IncomeSheet
    v-if="incomes.overview.value && editing"
    :open="open && !!editing"
    back
    :overview="incomes.overview.value"
    :editing="editing"
    :record="incomes.record"
    :amend="amend"
    @update:open="$emit('update:open', $event)"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { IncomeAmendBody, IncomeView } from '@molvia/model'
import IncomeSheet from '@/components/IncomeSheet.vue'
import type { AmendOutcome } from '@/composables/useExchanges'
import { incomesOf, useIncomes } from '@/composables/useIncomes'

/**
 * An income opened from an account's journal, «не попали» or a check (MOL-123): its own sheet, over
 * the list it was tapped in. The sheet amends the income whole, so the income is read from «Доходы»
 * first — which needs the connection an income is written with anyway.
 */
export default defineComponent({
  name: 'OperationIncomeSheet',
  components: { IncomeSheet },
  props: {
    open: { type: Boolean, required: true },
    id: { type: String, required: true },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    saved: () => true,
    unavailable: () => true,
  },
  setup(props, { emit }) {
    const incomes = useIncomes()
    const held = ref<IncomeView | null>(null)
    const found = computed(
      () => incomesOf(incomes.overview.value).find((income) => income.id === props.id) ?? null,
    )
    const editing = computed(() => held.value ?? found.value)
    watch(
      () => [incomes.phase.value, found.value] as const,
      ([phase, income]) => {
        // Only until the sheet is up: a failed read later must not close it under the typing.
        if (held.value) return
        if (income) {
          held.value = income
          return
        }
        if (phase !== 'idle' && phase !== 'loading') emit('unavailable')
      },
      { immediate: true },
    )
    async function amend(id: string, body: IncomeAmendBody): Promise<AmendOutcome> {
      const outcome = await incomes.amend(id, body)
      if (outcome === 'conflict') held.value = found.value ?? held.value
      if (outcome === 'saved') emit('saved')
      return outcome
    }
    return { incomes, editing, amend }
  },
})
</script>
