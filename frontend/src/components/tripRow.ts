import type { CatalogueEntry, Money, Quantity, TripExpenseView, UnitPrice } from '@molvia/model'

/** Why a row is not the server's last word: what the queue still holds about it (MOL-22, Н-6). */
export type RowMark = 'waiting' | 'editing' | 'removing' | null

/**
 * One line of the trip, wherever it came from: a row the server answered with, or a purchase
 * still in the queue. The screen builds it; `TripRow` only draws it.
 *
 * In a module of its own rather than in the component: an SFC exports a component, and a type
 * exported beside it is read as `any` by everything that is not the Vue compiler.
 */
export interface TripRowView {
  readonly key: string
  readonly name: string
  readonly quantity: Quantity | null
  readonly amount: Money | null
  readonly unitPrice: UnitPrice | null
  readonly mark: RowMark
  /** The card the sheet needs to open on this row; null when the phone cannot read it (Б1). */
  readonly entry: CatalogueEntry | null
  /** The server's row behind the line, when there is one: what the sheet amends. */
  readonly expense: TripExpenseView | null
}
