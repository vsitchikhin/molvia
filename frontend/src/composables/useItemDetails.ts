import { computed, nextTick, ref, toValue, watch } from 'vue'
import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue'
import {
  ERROR,
  INVISIBLE,
  addMoney,
  convertMoney,
  decimalFromMilli,
  decimalFromMinor,
  parseMoney,
  parseQuantity,
  subtractMoney,
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

const INVISIBLE_CHARACTERS = new RegExp(`[${INVISIBLE}]`, 'gu')

/**
 * What the field shows is what is parsed: a character that draws nothing — a zero-width space
 * pasted with the price — is not input. Left in, it turned a field that looks empty into «not an
 * amount» and blocked the purchase (adversarial A7).
 */
function parsed<T>(text: string, parse: (text: string) => T): Parsed<T> {
  const visible = text.replace(INVISIBLE_CHARACTERS, '')
  if (visible.trim() === '') return BLANK
  try {
    return { kind: 'value', value: parse(visible) }
  } catch {
    return INVALID
  }
}

/**
 * A purchase is named by the device (MOL-21). `randomUUID` exists only in a secure context, and a
 * phone on the LAN over plain http — `PWA_EXPOSE=1 make dev` without `make certs` — is not one
 * (review Р-6); `getRandomValues` is there everywhere.
 */
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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

/** A refused purchase as the sheet takes it back: its own identifier and what was typed. */
export interface RetryPurchase {
  readonly id: string
  readonly quantity: Quantity | null
  readonly amount: Money | null
}

export interface ItemDetailsInput {
  readonly entry: CatalogueEntry
  readonly trip: MaybeRefOrGetter<TripView | null>
  /**
   * The currency a price starts in: the trip's, or the person's own when there is no trip yet.
   * Until the person picks one, the price follows the trip's currency as it arrives (Р-3).
   */
  readonly currency: Currency
  /**
   * What the trip already holds, per currency — its total and the purchases still queued. A price
   * the trip cannot add to it is refused here, where the person still sees the field: the server
   * would refuse it once the sheet is gone (adversarial A9).
   */
  readonly occupied?: MaybeRefOrGetter<readonly Money[]>
  /** The row being amended, or none when a purchase is being added. */
  readonly expense?: TripExpenseView | null
  /**
   * A purchase the server refused, opened again to be corrected (MOL-22, В-3). Still an addition,
   * not an amendment — there is no row to amend — and it keeps the purchase's own identifier: the
   * server never took it, so the same id cannot meet a second copy of itself.
   */
  readonly retry?: RetryPurchase | null
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
  /** What the sheet opens filled with: the row being amended, or the purchase being corrected. */
  const filled = expense ?? input.retry ?? null

  function initialQuantity(): string {
    if (filled) return filled.quantity ? shown(decimalFromMilli(filled.quantity), separator) : ''
    const typical = input.entry.typicalQuantity
    if (typical) return shown(decimalFromMilli(typical), separator)
    // A piece is one unless said otherwise; a weight left at «1 kg» would turn the price of a
    // bag into a wrong price per kilo that nobody notices (В-4).
    return input.entry.defaultUnit === 'piece' ? '1' : ''
  }

  const quantity = ref(initialQuantity())
  const unit = ref<BaseUnit>(
    filled?.quantity?.unit ?? input.entry.typicalQuantity?.unit ?? input.entry.defaultUnit,
  )
  const amount = ref(filled?.amount ? shown(decimalFromMinor(filled.amount), separator) : '')
  const currency = ref<Currency>(filled?.amount?.currency ?? input.currency)

  // The price follows the trip's currency until the person picks one: the trip may arrive after
  // the sheet opened (В-6), in a currency other than the person's own (review Р-3). A price
  // already typed is a choice too — the sign must not change under «520», which would then go
  // as 520 dollars rather than 520 drams (Р-12, adversarial Б4).
  let chosen = filled !== null
  let following = false
  watch(currency, () => {
    if (!following) chosen = true
  })
  watch(amount, (typed) => {
    if (typed.replace(INVISIBLE_CHARACTERS, '').trim() !== '') chosen = true
  })
  watch(
    () => toValue(input.trip)?.currency,
    (tripCurrency) => {
      if (chosen || !tripCurrency || tripCurrency === currency.value) return
      following = true
      currency.value = tripCurrency
      void nextTick(() => {
        following = false
      })
    },
  )

  const expenseId = expense?.id ?? input.retry?.id ?? newId()

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

  /**
   * Whether the trip can still add this price to what it holds — the server's own sum. A price
   * that does not fit is told «not an amount» on purpose: past 9·10¹⁶ ֏ of total no real price
   * lies, and a code of its own for it would be a word for a case nobody meets. For the same
   * reason queued amendments and removals are not counted, only queued additions (review Р-11).
   */
  const fits = computed(() => {
    const a = valueOf(parsedAmount.value)
    if (!a) return true
    const held = toValue(input.occupied ?? [])
    const same = held.find((money) => money.currency === a.currency)
    if (!same) return true
    try {
      // An amended row is already in the total: it is replaced, not added again.
      const base =
        original.amount?.currency === a.currency ? subtractMoney(same, original.amount) : same
      addMoney(base, a)
      return true
    } catch {
      return false
    }
  })

  const amountWrong = computed(() => parsedAmount.value.kind === 'invalid' || !fits.value)

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
    amount: touched.value.amount && amountWrong.value ? ERROR.INVALID_AMOUNT : null,
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
    if (amountWrong.value) return 'amount'
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
