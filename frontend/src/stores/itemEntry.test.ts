import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { CatalogueEntry } from '@molvia/model'
import { useItemEntryStore } from '@/stores/itemEntry'

const milk: CatalogueEntry = {
  id: '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c',
  kind: 'product',
  name: 'Молоко «Ашхар»',
  note: null,
  defaultUnit: 'l',
  typicalQuantity: null,
}
const bread: CatalogueEntry = { ...milk, id: '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d', name: 'Хлеб' }

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('the pick', () => {
  it('keeps the query exactly as typed, spaces and case included', () => {
    const store = useItemEntryStore()

    store.pick({ entry: milk, query: '  Мол ' })

    expect(store.picked).toEqual({ entry: milk, query: '  Мол ' })
  })

  it('is replaced by the next one and gone after clear', () => {
    const store = useItemEntryStore()
    store.pick({ entry: milk, query: 'мол' })

    store.pick({ entry: bread, query: 'хл' })
    expect(store.picked?.entry.id).toBe(bread.id)

    store.clear()
    expect(store.picked).toBeNull()
  })
})
