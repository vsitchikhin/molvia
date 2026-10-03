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
      <span class="currency">
        <select
          :value="currency"
          class="currency-select"
          :aria-label="t('item.currency')"
          @change="pick"
        >
          <option v-for="option in currencies" :key="option.value" :value="option.value">
            {{ option.sign }}
          </option>
        </select>
        <IconMenuDown class="currency-caret" aria-hidden="true" />
      </span>
    </template>
  </AppField>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconMenuDown from '~icons/mdi/menu-down'
import { currencySchema, currencySign } from '@molvia/model'
import type { Currency } from '@molvia/model'
import AppField from '@/components/AppField.vue'

/**
 * The field of «Сумма по чеку» (MOL-78): one sum in one currency (В-3) — the record's own to begin
 * with, any of the four by the sign beside the number, as the price of a purchase is chosen. A card
 * in another currency is «списано со счёта», not a second sum. Shared by the sheet of the sum and
 * the question of «Закончить», so the two read and look alike.
 */
export default defineComponent({
  name: 'ReceiptField',
  components: { AppField, IconMenuDown },
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
  setup(_, { emit }) {
    const { t, locale } = useI18n()
    const currencies = computed(() =>
      currencySchema.options.map((value) => ({ value, sign: currencySign(value, locale.value) })),
    )
    function pick(event: Event): void {
      const parsed = currencySchema.safeParse((event.target as HTMLSelectElement).value)
      if (parsed.success) emit('update:currency', parsed.data)
    }
    return { t, currencies, pick }
  },
})
</script>

<style scoped lang="scss">
.optional {
  color: var(--text-muted);
  font-weight: var(--weight-regular);
}

.currency {
  position: relative;
  display: flex;
  align-items: center;
}

.currency-select {
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  padding: 0 var(--space-4) 0 var(--space-1);
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  appearance: none;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

.currency-caret {
  @include icon;

  font-size: var(--icon);
  position: absolute;
  right: 0;
  pointer-events: none;
}
</style>
