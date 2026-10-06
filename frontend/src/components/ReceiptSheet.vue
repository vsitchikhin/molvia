<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('trip.receipt.sheet.title') }}</template>
    <p class="body">{{ t('trip.receipt.sheet.body') }}</p>
    <ReceiptField
      v-model="amount"
      v-model:currency="currency"
      :label="t('trip.receipt.sheet.label')"
      :bad="bad"
      @keydown.enter.prevent="save"
    />

    <template #footer>
      <AppButton size="large" block @click="save">{{ t('trip.receipt.sheet.save') }}</AppButton>
      <AppButton v-if="current && removable" variant="danger-ghost" block @click="clear">{{
        t('trip.receipt.sheet.remove')
      }}</AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Currency, Money } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ReceiptField from '@/components/ReceiptField.vue'
import { receiptText, typedReceipt } from '@/components/receipt'
import { useTripQueueStore } from '@/stores/tripQueue'

/**
 * «Сумма по чеку» (MOL-78): the receipt's sum whole, typed at any time into a record open or
 * finished. It goes through the trip's queue, as every write to a trip does (MOL-24), and the sheet
 * closes at once — with no signal too. What it does to the total is the server's to say: the
 * figures under «Итого по чеку» come with the answer, and until then the card says the sum is on its
 * way (MOL-82's rule: a write in the queue is a row, never a figure).
 *
 * The prices stay as they are and nothing is worked out of the sum (requirements п. 3): the sheet
 * says so, since a person who typed the receipt may expect the prices to fill in.
 */
export default defineComponent({
  name: 'ReceiptSheet',
  components: { AppButton, BottomSheet, ReceiptField },
  props: {
    open: { type: Boolean, required: true },
    tripId: { type: String, required: true },
    /** The record's own currency — what a new sum starts in (В-3). */
    tripCurrency: { type: String as PropType<Currency>, required: true },
    /** The sum the record holds, or the one still in the queue; null for none. */
    current: { type: Object as PropType<Money | null>, default: null },
    /**
     * Whether the sum may be taken off: not from a finished record with no purchase, which would be left
     * with no money and nothing in it — the server refuses it (MOL-227, adversarial А4).
     */
    removable: { type: Boolean, default: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const queue = useTripQueueStore()

    const amount = ref('')
    const currency = ref<Currency>(props.tripCurrency)
    const bad = ref(false)

    watch(
      () => props.open,
      (open) => {
        if (!open) return
        const held = props.current
        amount.value = held ? receiptText(held, locale.value) : ''
        currency.value = held?.currency ?? props.tripCurrency
        bad.value = false
      },
      { immediate: true },
    )

    function write(receipt: Money | null): void {
      queue.enqueue({ kind: 'receipt', tripId: props.tripId, body: { receipt } })
      emit('update:open', false)
    }

    function save(): void {
      const receipt = typedReceipt(amount.value, currency.value)
      bad.value = receipt === null
      if (receipt) write(receipt)
    }

    function clear(): void {
      write(null)
    }

    return { t, amount, currency, bad, save, clear }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0 0 var(--space-4);
  color: var(--text-muted);
  font-size: var(--text-callout);
}
</style>
