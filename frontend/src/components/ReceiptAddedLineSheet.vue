<template>
  <BottomSheet :open="open" :on-closed="onClosed" @update:open="$emit('update:open', $event)">
    <template #title>{{ t('receipt.added.title') }}</template>
    <template #meta>{{ t('receipt.added.meta') }}</template>

    <div class="form">
      <!-- The item: the catalogue's search from an empty field, or a new one named there (MOL-273). -->
      <div class="field">
        <span class="label">{{ t('receipt.line.product') }}</span>
        <button
          class="product"
          :class="{ bad: itemMissing }"
          type="button"
          data-field="item"
          @click="picking = true"
        >
          <span v-if="item" class="product-name">{{ item.name }}</span>
          <span v-else class="product-empty">{{ t('receipt.added.pick') }}</span>
          <span class="product-other"
            >{{ item ? t('receipt.line.product_other') : ''
            }}<IconChevronRight class="other-chevron" aria-hidden="true"
          /></span>
        </button>
        <p v-if="item && !('id' in item)" class="hint">{{ t('receipt.line.name_note') }}</p>
        <p v-if="itemMissing" class="error">{{ t('receipt.added.item_missing') }}</p>
      </div>

      <div class="row">
        <AppField
          v-model="quantity"
          class="quantity"
          :label="t('item.quantity')"
          kind="decimal"
          :error="quantityBad ? ERROR.INVALID_QUANTITY : null"
          data-field="quantity"
        />
        <SegmentedControl v-model="unit" :legend="t('item.unit')" :options="units" />
      </div>

      <AppField
        v-model="amount"
        :label="t('receipt.line.price')"
        kind="decimal"
        :error="amountBad ? ERROR.INVALID_AMOUNT : null"
        data-field="amount"
      >
        <template #suffix
          ><span class="sign">{{ sign }}</span></template
        >
      </AppField>
      <p class="hint">{{ t('receipt.added.figures_note') }}</p>

      <div class="per-unit">
        <span class="per-unit-label">{{ t('item.unit_price_label') }}</span>
        <span class="per-unit-value">{{ perUnit ?? '—' }}</span>
      </div>
    </div>

    <template #footer>
      <AppButton size="large" block @click="save">{{ t('receipt.added.save') }}</AppButton>
      <AppButton v-if="line" variant="ghost" block @click="remove">{{
        t('receipt.added.remove')
      }}</AppButton>
    </template>
  </BottomSheet>

  <ItemPickSheet v-model:open="picking" :start="item?.name ?? ''" @picked="picked" />
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { useI18n } from 'vue-i18n'
import IconChevronRight from '~icons/mdi/chevron-right'
import {
  ERROR,
  INVISIBLE,
  currencySign,
  decimalFromMilli,
  formatUnitPrice,
  parseMoney,
  parseQuantity,
  unitPrice,
} from '@molvia/model'
import type { BaseUnit, Currency, Money, Quantity } from '@molvia/model'
import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import BottomSheet from '@/components/BottomSheet.vue'
import ItemPickSheet from '@/components/ItemPickSheet.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { receiptText } from '@/components/receipt'
import { shown } from '@/composables/useItemDetails'
import { newId } from '@/ids'
import type { AddedLineDraft } from '@/stores/receiptDrafts'

const UNITS: readonly BaseUnit[] = ['kg', 'l', 'piece']
const INVISIBLE_CHARACTERS = new RegExp(`[${INVISIBLE}]`, 'gu')

/**
 * «Новая строка» (MOL-273): a line the reader lost, typed on the review from the paper — the item, how
 * much and what it cost «как в чеке». Nothing printed, so nothing to compare: no «как напечатано», no «≠»,
 * no memory of the shop. Only the item is required. It writes nothing: «Готово» hands the line to the
 * receipt's drafts on the phone, and it goes with «Записать N». Mounted per opening.
 */
export default defineComponent({
  name: 'ReceiptAddedLineSheet',
  components: {
    AppButton,
    AppField,
    BottomSheet,
    IconChevronRight,
    ItemPickSheet,
    SegmentedControl,
  },
  props: {
    open: { type: Boolean, required: true },
    /** The line typed before, to put right; `null` — a new one. */
    line: { type: Object as PropType<AddedLineDraft | null>, default: null },
    currency: { type: String as PropType<Currency>, required: true },
    onClosed: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    'update:open': (open: boolean) => typeof open === 'boolean',
    saved: (line: AddedLineDraft) => typeof line === 'object',
    removed: (key: string) => typeof key === 'string',
  },
  setup(props, { emit }) {
    const { t, locale } = useI18n()
    const separator = locale.value === 'ru' ? ',' : '.'
    const start = props.line
    const item = ref<AddedLineDraft['item'] | null>(start?.item ?? null)
    const startQuantity = start?.figures.quantity ?? null
    const quantity = ref(startQuantity ? shown(decimalFromMilli(startQuantity), separator) : '')
    const unit = ref<BaseUnit>(startQuantity?.unit ?? 'piece')
    const startAmount = start?.figures.amount ?? null
    const amount = ref(startAmount ? receiptText(startAmount, locale.value) : '')
    const picking = ref(false)
    const quantityBad = ref(false)
    const amountBad = ref(false)
    const itemMissing = ref(false)

    // As the line's own sheet reads a field: what draws nothing is not input (review 22 of MOL-127).
    const visible = (text: string) => text.replace(INVISIBLE_CHARACTERS, '').trim()
    function typedQuantity(): Quantity | null | 'bad' {
      const text = visible(quantity.value)
      if (!text) return null
      try {
        return parseQuantity(text, unit.value)
      } catch {
        return 'bad'
      }
    }
    function typedAmount(): Money | null | 'bad' {
      const text = visible(amount.value)
      if (!text) return null
      try {
        return parseMoney(text, props.currency)
      } catch {
        return 'bad'
      }
    }
    watch(quantity, () => {
      quantityBad.value = false
    })
    watch(amount, () => {
      amountBad.value = false
    })
    const perUnit = computed(() => {
      const money = typedAmount()
      const many = typedQuantity()
      if (money === null || money === 'bad' || many === null || many === 'bad') return null
      if (many.milli <= 0n) return null
      try {
        const price = unitPrice(money, many)
        return t('item.unit_price_value', {
          amount: formatUnitPrice(price, locale.value),
          unit: t(`item.unit_${price.unit}`),
        })
      } catch {
        return null
      }
    })

    return {
      t,
      ERROR,
      item,
      quantity,
      unit,
      amount,
      picking,
      quantityBad,
      amountBad,
      itemMissing,
      perUnit,
      units: computed(() => UNITS.map((value) => ({ value, label: t(`item.unit_${value}`) }))),
      sign: computed(() => currencySign(props.currency, locale.value)),
      picked: (chosen: { id: string; name: string } | { name: string }) => {
        item.value = chosen
        itemMissing.value = false
        picking.value = false
      },
      save: () => {
        const many = typedQuantity()
        const money = typedAmount()
        quantityBad.value = many === 'bad'
        amountBad.value = money === 'bad'
        itemMissing.value = item.value === null
        if (many === 'bad' || money === 'bad' || item.value === null) return
        emit('saved', {
          key: start?.key ?? newId(),
          item: item.value,
          figures: { quantity: many, amount: money },
        })
        emit('update:open', false)
      },
      remove: () => {
        if (start) emit('removed', start.key)
        emit('update:open', false)
      },
    }
  },
})
</script>

<style scoped lang="scss">
.form {
  display: grid;
  gap: var(--space-4);
}

.hint,
.error {
  margin: calc(var(--space-2) * -1) 0 0;
  font-size: var(--text-footnote);
}

.hint {
  color: var(--text-muted);
}

.error {
  color: var(--bad-ink);
}

.field {
  display: grid;
  gap: var(--space-2);
}

.label {
  font-size: var(--text-callout);
  font-weight: var(--weight-medium);
}

.product {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  justify-content: space-between;
  min-height: var(--touch-target-lg);
  padding: var(--space-2) var(--space-4);
  border: var(--hairline) solid var(--border-strong);
  border-radius: var(--radius);
  color: var(--text);
  background: var(--surface-2);
  text-align: left;
  font: inherit;
  cursor: pointer;

  &.bad {
    border-color: var(--bad);
  }

  &:focus-visible {
    @include focus-ring;
  }
}

.product-name {
  font-size: var(--text-headline);
  font-weight: var(--weight-medium);
  overflow-wrap: anywhere;
}

.product-empty {
  color: var(--text-muted);
}

.product-other {
  display: inline-flex;
  flex: none;
  align-items: center;
  color: var(--accent-ink);
  font-weight: var(--weight-medium);
}

.other-chevron {
  @include icon;

  font-size: var(--icon);
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: var(--space-3);
  align-items: start;
}

// The field's grid sizes its column by the input's own width (as the line's sheet).
.row > * {
  min-width: 0;
}

.quantity {
  grid-template-columns: minmax(0, 1fr);
}

.sign {
  padding: 0 var(--space-3);
  color: var(--text-muted);
}

.per-unit {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  justify-content: space-between;
  min-height: var(--touch-target-lg);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  color: var(--good-ink);
  background: var(--good-tint);
}

.per-unit-label {
  font-size: var(--text-footnote);
  font-weight: var(--weight-medium);
}

.per-unit-value {
  @include display-type;

  font-size: var(--text-title);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
