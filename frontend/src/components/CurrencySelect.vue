<template>
  <span class="currency-select">
    <select :value="modelValue" class="currency-control" :aria-label="label" @change="pick">
      <option v-for="option in currencies" :key="option.value" :value="option.value">
        {{ option.sign }}
      </option>
    </select>
    <IconMenuDown class="currency-caret" aria-hidden="true" />
  </span>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconMenuDown from '~icons/mdi/menu-down'
import { currencySchema, currencySign } from '@molvia/model'
import type { Currency } from '@molvia/model'

/**
 * The currency beside an amount, chosen by its sign (MOL-235, Ф-12): the tail of an `AppField`, as
 * the price of a purchase and «Сумма по чеку» have it — each had drawn its own copy. A native
 * `<select>`, so the phone opens its own picker; the well draws the field's focus around it, and the
 * select its own ring, so the keyboard tells the currency from the figure.
 */
export default defineComponent({
  name: 'CurrencySelect',
  components: { IconMenuDown },
  props: {
    modelValue: { type: String as PropType<Currency>, required: true },
    /** Its name aloud — «Валюта цены»: no label is drawn for it. */
    label: { type: String, required: true },
  },
  emits: {
    'update:modelValue': (value: Currency) => currencySchema.safeParse(value).success,
  },
  setup(_, { emit }) {
    const { locale } = useI18n()
    const currencies = computed(() =>
      currencySchema.options.map((value) => ({ value, sign: currencySign(value, locale.value) })),
    )
    function pick(event: Event): void {
      const parsed = currencySchema.safeParse((event.target as HTMLSelectElement).value)
      if (parsed.success) emit('update:modelValue', parsed.data)
    }
    return { currencies, pick }
  },
})
</script>

<style scoped lang="scss">
.currency-select {
  position: relative;
  display: flex;
  align-items: center;
}

.currency-control {
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  padding: 0 var(--space-4) 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  appearance: none;
  cursor: pointer;

  &:focus-visible {
    @include focus-ring;
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
