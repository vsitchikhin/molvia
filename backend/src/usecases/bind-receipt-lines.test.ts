import { describe, expect, it, vi } from 'vitest'
import { itemSchema } from '@molvia/model'
import type { CatalogueNode, Item, ReceiptLine } from '@molvia/model'
import type { ItemRepository, SearchAnswer } from '@/db/items-repository'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import { bindReceiptLines } from './bind-receipt-lines'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MILK = '00000000-0000-4000-8000-000000000001'
const GLUE = '00000000-0000-4000-8000-000000000002'
const SOUR_CREAM = '00000000-0000-4000-8000-000000000003'

const NODES: CatalogueNode[] = [
  { itemId: MILK, name: 'Молоко', names: ['կաթ'], headings: ['0401'] },
  { itemId: GLUE, name: 'Клей', names: ['սոսինձ'], headings: ['3506'] },
]

function item(id: string, name: string): Item {
  return itemSchema.parse({
    id,
    kind: 'product',
    name,
    searchKey: name,
    barcodes: [],
    note: null,
    defaultUnit: 'piece',
    typicalQuantity: null,
    createdBy: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
  })
}

const line = (printed: string, hs: string | null = null): ReceiptLine => ({
  printed,
  hs,
  sku: null,
  quantity: null,
  price: null,
  sum: null,
  discount: null,
  settled: false,
})

function fakeItems(answer: SearchAnswer = { items: [], near: false, nearIds: [] }) {
  const search = vi.fn<ItemRepository['search']>(() => Promise.resolve(answer))
  return { items: { nodes: () => Promise.resolve(NODES), search }, search }
}

describe('binding the lines of a parsed receipt (MOL-126)', () => {
  it('finds the item by its Armenian name, and a heading alone is far', async () => {
    const { items, search } = fakeItems()
    const bound = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('Կաթ «Իգիթ» 1լ', '0401'),
      line('ԴԱՐԱՆ ԿԼԵՅ', '3506'),
    ])
    expect(bound).toEqual([
      { itemId: MILK, match: 'search', translation: 'молоко' },
      { itemId: GLUE, match: 'weak', translation: null },
    ])
    expect(search).not.toHaveBeenCalled()
  })

  it('asks the search by the gloss when the names find nothing: near is found, far is «проверьте»', async () => {
    const near = fakeItems({
      items: [item(SOUR_CREAM, 'Сметана')],
      near: true,
      nearIds: [SOUR_CREAM],
    })
    const [found] = await bindReceiptLines(
      { items: near.items, embedder: NO_EMBEDDER },
      ACTOR,
      'AM',
      'ru',
      [line('ԹԹՎԱՍԵՐ 20%')],
    )
    expect(found).toEqual({ itemId: SOUR_CREAM, match: 'search', translation: 'сметана' })
    expect(near.search).toHaveBeenCalledWith('сметана', 5, ACTOR, null)

    const far = fakeItems({ items: [item(SOUR_CREAM, 'Сметана')], near: false, nearIds: [] })
    const [weak] = await bindReceiptLines(
      { items: far.items, embedder: NO_EMBEDDER },
      ACTOR,
      'AM',
      'ru',
      [line('ԹԹՎԱՍԵՐ 20%')],
    )
    expect(weak).toEqual({ itemId: SOUR_CREAM, match: 'weak', translation: 'сметана' })
  })

  it('binds a dish of a class of services only as «проверьте», by its names or the search (MOL-226)', async () => {
    const { items } = fakeItems({
      items: [item(SOUR_CREAM, 'Сметана')],
      near: true,
      nearIds: [SOUR_CREAM],
    })
    const bound = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('Կաթ', '56.10'),
      line('ԹԹՎԱՍԵՐ 20%', '56.10'),
    ])
    expect(bound).toEqual([
      { itemId: MILK, match: 'weak', translation: 'молоко' },
      { itemId: SOUR_CREAM, match: 'weak', translation: 'сметана' },
    ])
  })

  it('leaves a line new when nothing is found, named by its gloss', async () => {
    const { items } = fakeItems()
    const bound = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('ԹԹՎԱՍԵՐ 20%'),
      line('ՔՍՅԶՔ 77'),
    ])
    expect(bound).toEqual([
      { itemId: null, match: 'new', translation: 'сметана' },
      { itemId: null, match: 'new', translation: null },
    ])
  })

  it('shows no Russian gloss on a receipt read out in English, and searches by it all the same', async () => {
    const { items, search } = fakeItems({
      items: [item(SOUR_CREAM, 'Сметана')],
      near: true,
      nearIds: [SOUR_CREAM],
    })
    const bound = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'en', [
      line('Կաթ', '0401'),
      line('ԹԹՎԱՍԵՐ 20%'),
    ])
    expect(bound).toEqual([
      { itemId: MILK, match: 'search', translation: null },
      { itemId: SOUR_CREAM, match: 'search', translation: null },
    ])
    expect(search).toHaveBeenCalledWith('сметана', 5, ACTOR, null)
  })
})

describe('binding the lines of a Serbian receipt by its link (MOL-232, В-3)', () => {
  it('reads no names and no gloss: the search by the line’s name whole, near or far', async () => {
    const nodes = vi.fn(() => Promise.resolve(NODES))
    const search = vi.fn<ItemRepository['search']>((query) =>
      Promise.resolve(
        query === 'Banana'
          ? { items: [item(MILK, 'Бананы')], near: true, nearIds: [MILK] }
          : query === 'Zitopek beli hleb'
            ? { items: [item(GLUE, 'Хлеб белый')], near: false, nearIds: [] }
            : { items: [], near: false, nearIds: [] },
      ),
    )
    const bound = await bindReceiptLines(
      { items: { nodes, search }, embedder: NO_EMBEDDER },
      ACTOR,
      'RS',
      'ru',
      [line('BANANA KG'), line('Zitopek beli hleb /kom'), line('UBRUS JUMBO 2SL 1/1 NATU KOM')],
    )
    expect(nodes).not.toHaveBeenCalled()
    expect(search.mock.calls.map(([query]) => query)).toEqual([
      'Banana',
      'Zitopek beli hleb',
      'Ubrus jumbo 2sl 1/1 natu',
    ])
    expect(bound).toEqual([
      { itemId: MILK, match: 'search', translation: null },
      { itemId: GLUE, match: 'weak', translation: null },
      { itemId: null, match: 'new', translation: null },
    ])
  })

  it('asks nothing for a name under three letters', async () => {
    const search = vi.fn<ItemRepository['search']>()
    const bound = await bindReceiptLines(
      { items: { nodes: () => Promise.resolve(NODES), search }, embedder: NO_EMBEDDER },
      ACTOR,
      'RS',
      'ru',
      [line('KO')],
    )
    expect(search).not.toHaveBeenCalled()
    expect(bound).toEqual([{ itemId: null, match: 'new', translation: null }])
  })

  it('marks a delivery and a tip «проверьте» with no item, and asks the search nothing (А6)', async () => {
    const search = vi.fn<ItemRepository['search']>()
    const bound = await bindReceiptLines(
      { items: { nodes: () => Promise.resolve(NODES), search }, embedder: NO_EMBEDDER },
      ACTOR,
      'RS',
      'ru',
      [line('Достава'), line('Напојница')],
    )
    expect(search).not.toHaveBeenCalled()
    expect(bound).toEqual([
      { itemId: null, match: 'weak', translation: null },
      { itemId: null, match: 'weak', translation: null },
    ])
  })
})
