import { computed, ref, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import {
  ERROR,
  convertMoney,
  decimalFromMilli,
  decimalFromMinor,
  parseMoney,
  parseQuantity,
  unitPrice as unitPriceOf,
} from '@molvia/model'
import type {
  AddExpenseBody,
  BaseUnit,
  CatalogueEntry,
  Currency,
  ErrorCode,
  ExpensePatch,
  Money,
  Quantity,
  TripExpenseView,
  TripView,
  UnitPrice,
} from '@molvia/model'

export type DetailsField = 'quantity' | 'amount'

/** Blank, a value, or something that is not one — three answers the sheet treats differently. */
type Parsed<T> =
  | { readonly kind: 'blank' }
  | { readonly kind: 'value'; readonly value: T }
  | {
      readonly kind: 'invalid'
    }

const BLANK = { kind: 'blank' } as const
const INVALID = { kind: 'invalid' } as const

function parsed<T>(text: string, parse: (text: string) => T): Parsed<T> {
  if (text.trim() === '') return BLANK
  try {
    return { kind: 'value', value: parse(text) }
  } catch {
    return INVALID
  }
}

function valueOf<T>(field: Parsed<T>): T | null {
  return field.kind === 'value' ? field.value : null
}

/** «1.000» → «1», «0.900» → «0,9» on a Russian keyboard: what a person types, not what the wire carries. */
function shown(decimal: string, separator: string): string {
  const trimmed = decimal.includes('.') ? decimal.replace(/0+$/, '').replace(/\.$/, '') : decimal
  return trimmed.replace('.', separator)
}

function sameQuantity(a: Quantity | null, b: Quantity | null): boolean {
  return a?.milli === b?.milli && a?.unit === b?.unit
}

function sameMoney(a: Money | null, b: Money | null): boolean {
  return a?.minor === b?.minor && a?.currency === b?.currency
}

export interface ItemDetailsInput {
  readonly entry: CatalogueEntry
  readonly trip: MaybeRefOrGetter<TripView | null>
  /** The currency a price starts in: the trip's, or the person's own when there is no trip yet. */
  readonly currency: Currency
  /** The row being amended, or none when a purchase is being added. */
  readonly expense?: TripExpenseView | null
  /** The decimal separator of the interface: a Russian keyboard writes «0,9». */
  readonly separator?: string
}

export interface ItemDetails {
  readonly quantity: Ref<string>
  readonly unit: Ref<BaseUnit>
  readonly amount: Ref<string>
  readonly currency: Ref<Currency>
  readonly expenseId: string
  readonly unitPrice: ComputedRef<UnitPrice | null>
  readonly converted: ComputedRef<Money | null>
  readonly errors: ComputedRef<Record<DetailsField, ErrorCode | null>>
  leave: (field: DetailsField) => void
  validate: () => DetailsField | null
  body: (query: string | null) => AddExpenseBody
  patch: () => ExpensePatch | null
}

/**
 * The state of the sheet «сколько, в чём, почём»: raw strings as typed, parsed on the fly by
 * the domain's own functions.
 *
 * **The unit price here is `unitPrice()` of `packages/model`** — the function the server
 * computes with, not a second one (MOL-24, В-1). It has to be here: at the shelf with no
 * connection the price per litre is needed now, to decide whether to take the thing. Once the
 * row is written, what the trip shows is the server's number. The same holds for the estimate
 * in the trip's income currency (В-7).
 *
 * The identifier of the purchase is born with the sheet, not with the tap (Н-3): the device
 * names the row, and a double tap or a resend after a lost answer meets the same row.
 */
export function useItemDetails(input: ItemDetailsInput): ItemDetails {
  const separator = input.separator ?? ','
  const expense = input.expense ?? null
  const original = { quantity: expense?.quantity ?? null, amount: expense?.amount ?? null }

  function initialQuantity(): string {
    if (expense)
      return original.quantity ? shown(decimalFromMilli(original.quantity), separator) : ''
    const typical = input.entry.typicalQuantity
    if (typical) return shown(decimalFromMilli(typical), separator)
    // A piece is one unless said otherwise; a weight left at «1 kg» would turn the price of a
    // bag into a wrong price per kilo that nobody notices (В-4).
    return input.entry.defaultUnit === 'piece' ? '1' : ''
  }

  const quantity = ref(initialQuantity())
  const unit = ref<BaseUnit>(
    original.quantity?.unit ?? input.entry.typicalQuantity?.unit ?? input.entry.defaultUnit,
  )
  const amount = ref(original.amount ? shown(decimalFromMinor(original.amount), separator) : '')
  const currency = ref<Currency>(original.amount?.currency ?? input.currency)

  const expenseId = expense?.id ?? crypto.randomUUID()

  const parsedQuantity = computed(() =>
    parsed(quantity.value, (text) => parseQuantity(text, unit.value)),
  )
  const parsedAmount = computed(() =>
    parsed(amount.value, (text) => parseMoney(text, currency.value)),
  )

  const unitPrice = computed<UnitPrice | null>(() => {
    const q = valueOf(parsedQuantity.value)
    const a = valueOf(parsedAmount.value)
    return q && a ? unitPriceOf(a, q) : null
  })

  /**
   * The price of the package in the income currency, an estimate. Only for a price in the
   * currency the trip's rate converts: the snapshot is one pair, and a price in roubles or
   * dollars has nothing to be converted by (В-12).
   */
  const converted = computed<Money | null>(() => {
    const rate = toValue(input.trip)?.rate
    const a = valueOf(parsedAmount.value)
    if (!rate || !a) return null
    if (a.currency !== rate.quote) return null
    try {
      return convertMoney(a, rate)
    } catch {
      // Past int8: an estimate that does not fit is shown as none, never as a failure.
      return null
    }
  })

  // An error is shown once the person has left the field or pressed the button, not on every
  // keystroke: «1,» is a number on its way.
  const touched = ref<Record<DetailsField, boolean>>({ quantity: false, amount: false })

  // A unit changed under a typed quantity may make it wrong — half a piece — and that is seen
  // at once, without waiting for the field to be left.
  watch(unit, () => {
    if (quantity.value.trim() !== '') touched.value.quantity = true
  })

  const errors = computed<Record<DetailsField, ErrorCode | null>>(() => ({
    quantity:
      touched.value.quantity && parsedQuantity.value.kind === 'invalid'
        ? ERROR.INVALID_QUANTITY
        : null,
    amount:
      touched.value.amount && parsedAmount.value.kind === 'invalid' ? ERROR.INVALID_AMOUNT : null,
  }))

  function leave(field: DetailsField): void {
    touched.value[field] = true
  }

  /**
   * The first field that holds something that is not a value, or none. A blank is fine — «I will
   * fill it in later» — but what was typed as a price is not sent without it (В-5).
   */
  function validate(): DetailsField | null {
    touched.value = { quantity: true, amount: true }
    if (parsedQuantity.value.kind === 'invalid') return 'quantity'
    if (parsedAmount.value.kind === 'invalid') return 'amount'
    return null
  }

  /** The body of «Добавить в поход»: the item always, the rest only when it is there. */
  function body(query: string | null): AddExpenseBody {
    const q = valueOf(parsedQuantity.value)
    const a = valueOf(parsedAmount.value)
    return {
      id: expenseId,
      itemId: input.entry.id,
      ...(q ? { quantity: q } : {}),
      ...(a ? { amount: a } : {}),
      ...(query ? { query } : {}),
    }
  }

  /**
   * What changed, and nothing else; a cleared field is `null`, which erases it. Nothing changed
   * is `null` rather than an empty patch, which the server refuses (Н-5).
   */
  function patch(): ExpensePatch | null {
    const q = valueOf(parsedQuantity.value)
    const a = valueOf(parsedAmount.value)
    const changes: ExpensePatch = {
      ...(sameQuantity(q, original.quantity) ? {} : { quantity: q }),
      ...(sameMoney(a, original.amount) ? {} : { amount: a }),
    }
    return Object.keys(changes).length > 0 ? changes : null
  }

  return {
    quantity,
    unit,
    amount,
    currency,
    expenseId,
    unitPrice,
    converted,
    errors,
    leave,
    validate,
    body,
    patch,
  }
}
