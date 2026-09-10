import type { CatalogueSubject } from '#model/values/gate'
import type { ItemKind } from './item'
import type { PlaceKind } from './place'

/**
 * Four kinds of thing can be looked at and the gate has two halves, so the mapping is
 * written down: whoever writes the gate query in 0.3 would otherwise decide it from
 * memory, and the answer changes whether the gate passes. Frozen for the same reason
 * MINOR_EXPONENT is — a write here moves every recorded view into the other half.
 */
export const SUBJECT_OF_ITEM: Readonly<Record<ItemKind, CatalogueSubject>> = Object.freeze({
  product: 'product',
  dish: 'venue',
})

export const SUBJECT_OF_PLACE: Readonly<Record<PlaceKind, CatalogueSubject>> = Object.freeze({
  store: 'product',
  venue: 'venue',
})
