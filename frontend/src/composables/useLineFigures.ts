import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  INVISIBLE,
  decimalFromMilli,
  formatUnitPrice,
  parseMoney,
  parseQuantity,
  unitPrice,
} from '@molvia/model'
import type { BaseUnit, Currency, Money, Quantity, UnitPrice } from '@molvia/model'
import { receiptText } from '@/components/receipt'
import { shown } from '@/composables/useItemDetails'

const INVISIBLE_CHARACTERS = new RegExp(`[${INVISIBLE}]`, 'gu')

/** The fields of a line's figures, their reading and the price per unit they make. */
export interface LineFields {
  readonly quantity: Ref<string>
  readonly unit: Ref<BaseUnit>
  readonly amount: Ref<string>
  readonly quantityBad: Ref<boolean>
  readonly amountBad: Ref<boolean>
  readonly typedQuantity: () => Quantity | null | 'bad'
  readonly typedAmount: () => Money | null | 'bad'
  readonly parsedQuantity: ComputedRef<Quantity | null>
  readonly price: ComputedRef<UnitPrice | null>
  readonly perUnit: ComputedRef<string | null>
}

/**
 * The figures of a receipt's line as the person types them — how much, in what unit, «цена за всё» — and the price
 * per unit they make: one reading of the fields for «Строка чека» and «Новая строка» (MOL-273, self-review №1), so a
 * change of how a field is read — what draws nothing, the unit, the sum — is made once. As the purchase's sheet reads
 * a field (`useItemDetails`): what draws nothing is not input, and a space stays the domain's group separator
 * (review 22 of MOL-127). `bad` is a field that is not a figure, said once the person tries to save.
 */
export function useLineFigures(
  start: { readonly quantity: Quantity | null; readonly amount: Money | null },
  currency: () => Currency,
): LineFields {
  const { t, locale } = useI18n()
  const separator = locale.value === 'ru' ? ',' : '.'
  const quantity = ref(start.quantity ? shown(decimalFromMilli(start.quantity), separator) : '')
  const unit = ref<BaseUnit>(start.quantity?.unit ?? 'piece')
  const amount = ref(start.amount ? receiptText(start.amount, locale.value) : '')
  const quantityBad = ref(false)
  const amountBad = ref(false)

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
      return parseMoney(text, currency())
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
  const parsedQuantity = computed(() => {
    const value = typedQuantity()
    return value === 'bad' ? null : value
  })
  const parsedAmount = computed(() => {
    const value = typedAmount()
    return value === 'bad' ? null : value
  })
  const price = computed(() => {
    const money = parsedAmount.value
    const many = parsedQuantity.value
    if (!money || !many || many.milli <= 0n) return null
    try {
      return unitPrice(money, many)
    } catch {
      return null
    }
  })
  const perUnit = computed(() =>
    price.value
      ? t('item.unit_price_value', {
          amount: formatUnitPrice(price.value, locale.value),
          unit: t(`item.unit_${price.value.unit}`),
        })
      : null,
  )
  return {
    quantity,
    unit,
    amount,
    quantityBad,
    amountBad,
    typedQuantity,
    typedAmount,
    parsedQuantity,
    price,
    perUnit,
  }
}
