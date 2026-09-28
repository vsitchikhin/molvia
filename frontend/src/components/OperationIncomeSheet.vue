<template>
  <IncomeSheet
    v-if="incomes.overview.value && (editing || draft)"
    :open="open && (!!editing || !!draft)"
    back
    :overview="incomes.overview.value"
    :editing="editing"
    :draft="draft"
    :record="record"
    :amend="amend"
    @update:open="$emit('update:open', $event)"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import type { IncomeAmendBody, IncomeBody, IncomeView } from '@molvia/model'
import IncomeSheet from '@/components/IncomeSheet.vue'
import type { AmendOutcome } from '@/composables/useExchanges'
import { incomesOf, useIncomes } from '@/composables/useIncomes'
import type { IncomeDraft } from '@/composables/useIncomes'

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
    /** The income to amend; or none, with a `draft` of a new one (В-5). */
    id: { type: String as PropType<string | null>, default: null },
    draft: { type: Object as PropType<IncomeDraft | null>, default: null },
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
        if (props.draft) {
          if (phase === 'error' || phase === 'offline') emit('unavailable')
          return
        }
        if (phase !== 'idle' && phase !== 'loading') emit('unavailable')
      },
      { immediate: true },
    )
    async function record(body: IncomeBody): Promise<unknown> {
      const written = await incomes.record(body)
      // A draft names its income (В-5): a conflict under that name is the same difference written
      // already, by an answer that never came — the check counts again all the same.
      if (written || props.draft?.id) emit('saved')
      return written
    }
    async function amend(id: string, body: IncomeAmendBody): Promise<AmendOutcome> {
      const outcome = await incomes.amend(id, body)
      if (outcome === 'conflict') held.value = found.value ?? held.value
      if (outcome === 'saved') emit('saved')
      return outcome
    }
    return { incomes, editing, record, amend }
  },
})
</script>
