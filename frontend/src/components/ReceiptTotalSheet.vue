<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.review.total') }}</template>
    <p class="body">{{ t('trip.receipt.sheet.body') }}</p>
    <AppField
      v-model="amount"
      :label="t('trip.receipt.sheet.label')"
      kind="decimal"
      enterkeyhint="done"
      :error-text="bad ? t('spending.sheet.bad_amount') : null"
      @keydown.enter.prevent="save"
    >
      <template #suffix
        ><span class="sign">{{ sign }}</span></template
      >
    </AppField>

    <template #footer>
      <AppButton size="large" block @click="save">{{ t('trip.receipt.sheet.save') }}</AppButton>
      <AppButton v-if="corrected" variant="ghost" block @click="clear">{{
        t('trip.receipt.sheet.remove')
      }}</AppButton>
    </template>
  </BottomSheet>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencySign } from '@molvia/model'
import type { Currency, Money } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import { receiptText, typedReceipt } from '@/components/receipt'

/**
 * «Итог чека» put right on the review (Р-8): OCR misses the total on half the receipts, and the
 * trip's money is the receipt's total (MOL-78), so the person types it — by the rule «Сумма по чеку»
 * reads a sum with (`typedReceipt`), in the receipt's own currency, which the server holds it to.
 * Saved into the draft, never the network: «Записать» sends it as `total`.
 */
export default defineComponent({
  name: 'ReceiptTotalSheet',
  components: { AppButton, AppField, BottomSheet },
  props: {
    open: { type: Boolean, required: true },
    currency: { type: String as PropType<Currency>, required: true },
    /** The total shown now: the person's, else the printed one. */
    current: { type: Object as PropType<Money | null>, default: null },
    /** Whether the person corrected it — «Убрать» goes back to the printed one. */
    corrected: { type: Boolean, default: false },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    saved: (total: Money | null) => total === null || typeof total === 'object',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const amount = ref('')
    const bad = ref(false)
    watch(
      () => props.open,
      (open) => {
        if (!open) return
        bad.value = false
        amount.value = props.current ? receiptText(props.current, locale.value) : ''
      },
      { immediate: true },
    )
    return {
      t,
      amount,
      bad,
      sign: computed(() => currencySign(props.currency, locale.value)),
      save: () => {
        const total = typedReceipt(amount.value, props.currency)
        if (!total) {
          bad.value = true
          return
        }
        emit('saved', total)
        emit('update:open', false)
      },
      clear: () => {
        emit('saved', null)
        emit('update:open', false)
      },
    }
  },
})
</script>

<style scoped lang="scss">
.body {
  margin: 0 0 var(--space-4);
  font-size: var(--text-callout);
}

.sign {
  padding: 0 var(--space-3);
  color: var(--text-muted);
}
</style>
