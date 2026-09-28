<template>
  <ExchangeSheet
    v-if="exchanges.overview.value && editing"
    :open="open && !!editing"
    back
    :overview="exchanges.overview.value"
    :editing="editing"
    :record="exchanges.record"
    :amend="amend"
    @update:open="$emit('update:open', $event)"
  />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { ExchangeAmendBody, ExchangeView } from '@molvia/model'
import ExchangeSheet from '@/components/ExchangeSheet.vue'
import type { AmendOutcome } from '@/composables/useExchanges'
import { useExchanges } from '@/composables/useExchanges'

/**
 * An exchange opened from an account's journal, «не попали» or a check (MOL-123): its own sheet, over
 * the list it was tapped in. The sheet amends the exchange whole, so the exchange is read from «Обмен денег»
 * first — which needs the connection an exchange is written with anyway.
 */
export default defineComponent({
  name: 'OperationExchangeSheet',
  components: { ExchangeSheet },
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
    const exchanges = useExchanges()
    const held = ref<ExchangeView | null>(null)
    const found = computed(
      () =>
        exchanges.overview.value?.exchanges.find((exchange) => exchange.id === props.id) ?? null,
    )
    const editing = computed(() => held.value ?? found.value)
    watch(
      () => [exchanges.phase.value, found.value] as const,
      ([phase, exchange]) => {
        if (exchange && !held.value) held.value = exchange
        if (
          phase === 'error' ||
          phase === 'offline' ||
          ((phase === 'ready' || phase === 'empty') && !exchange)
        )
          emit('unavailable')
      },
      { immediate: true },
    )
    async function amend(id: string, body: ExchangeAmendBody): Promise<AmendOutcome> {
      const outcome = await exchanges.amend(id, body)
      if (outcome === 'conflict') held.value = found.value ?? held.value
      if (outcome === 'saved') emit('saved')
      return outcome
    }
    return { exchanges, editing, amend }
  },
})
</script>
