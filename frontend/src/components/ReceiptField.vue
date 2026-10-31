<template>
  <AppField
    :model-value="modelValue"
    :label="label"
    kind="decimal"
    enterkeyhint="done"
    :error-text="bad ? t('spending.sheet.bad_amount') : null"
    data-field="receipt"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <template v-if="optional" #label-extra>
      <span class="optional">{{ t('spending.sheet.optional') }}</span>
    </template>
    <template #suffix>
      <CurrencySelect
        :model-value="currency"
        :label="t('item.currency')"
        @update:model-value="$emit('update:currency', $event)"
      />
    </template>
  </AppField>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencySchema } from '@molvia/model'
import type { Currency } from '@molvia/model'
import AppField from '@/components/AppField.vue'
import CurrencySelect from '@/components/CurrencySelect.vue'

/**
 * The field of «Сумма по чеку» (MOL-78): one sum in one currency (В-3) — the record's own to begin
 * with, any of the four by the sign beside the number, as the price of a purchase is chosen. A card
 * in another currency is «списано со счёта», not a second sum. Shared by the sheet of the sum and
 * the question of «Закончить», so the two read and look alike.
 */
export default defineComponent({
  name: 'ReceiptField',
  components: { AppField, CurrencySelect },
  props: {
    modelValue: { type: String, required: true },
    currency: { type: String as PropType<Currency>, required: true },
    label: { type: String, required: true },
    optional: { type: Boolean, default: false },
    bad: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (value: string) => typeof value === 'string',
    'update:currency': (value: Currency) => currencySchema.safeParse(value).success,
  },
  setup() {
    const { t } = useI18n()
    return { t }
  },
})
</script>

<style scoped lang="scss">
.optional {
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}
</style>
