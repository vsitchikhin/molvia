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

/** No item holds any code. */
const NONE: ItemRepository['byBarcode'] = () => Promise.resolve(null)

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
  return { items: { nodes: () => Promise.resolve(NODES), search, byBarcode: NONE }, search }
}

describe('binding the lines of a parsed receipt (MOL-126)', () => {
  it('finds the item by its Armenian name, and never by a heading alone (MOL-293)', async () => {
    const { items, search } = fakeItems()
    const bound = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('Կաթ 1լ', '0401'),
      line('ԴԱՐԱՆ ԿԼԵՅ', '3506'),
    ])
    expect(bound).toEqual([
      { itemId: MILK, match: 'search', translation: 'молоко' },
      // glue's heading names no word of the line: a new item, spelt as printed and «проверьте»
      { itemId: null, match: 'weak', translation: 'ДАРАН КЛЕЙ', spelled: true },
    ])
    expect(search).not.toHaveBeenCalled()
  })

  it('takes no item without the brand the line prints, nor one naming a flavour it has not (MOL-293)', async () => {
    const STRAWBERRY = '00000000-0000-4000-8000-000000000004'
    const { items, search } = fakeItems({
      items: [item(STRAWBERRY, 'Клубника'), item(MILK, 'Йогурт «Еремян Продактс» персик 2%')],
      near: true,
      nearIds: [STRAWBERRY, MILK],
    })
    const [yoghurt] = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('Յոգուրտ «Երեմյան Փրոդաքթս» ելակ 2% 130գր', '0403'),
    ])
    expect(yoghurt).toEqual({
      itemId: null,
      match: 'weak',
      translation: 'Йогурт «Еремян Продактс» клубника 2% 130 г',
      spelled: false,
    })
    expect(search).toHaveBeenCalledOnce()
  })

  it('takes the first of the search’s items the line lets stand, past those it does not', async () => {
    const STRAWBERRY = '00000000-0000-4000-8000-000000000004'
    const { items } = fakeItems({
      items: [item(STRAWBERRY, 'Клубника'), item(MILK, 'Йогурт')],
      near: true,
      nearIds: [MILK],
    })
    const [yoghurt] = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('Յոգուրտ ելակ 2%'),
    ])
    expect(yoghurt).toMatchObject({ itemId: MILK, match: 'search' })
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
    expect(near.search).toHaveBeenCalledWith('сметана', 10, ACTOR, null)

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

  it('marks «проверьте» an item the search found whose headings the printed one rules out (MOL-255)', async () => {
    // the seed's sour cream is 0403; a line printed 9603 — brushes — is no sour cream however the gloss read
    const nodes: CatalogueNode[] = [
      ...NODES,
      { itemId: SOUR_CREAM, name: 'Сметана', names: [], headings: ['0403'] },
    ]
    const search = vi.fn<ItemRepository['search']>(() =>
      Promise.resolve({ items: [item(SOUR_CREAM, 'Сметана')], near: true, nearIds: [SOUR_CREAM] }),
    )
    const bound = await bindReceiptLines(
      {
        items: { nodes: () => Promise.resolve(nodes), search, byBarcode: NONE },
        embedder: NO_EMBEDDER,
      },
      ACTOR,
      'AM',
      'ru',
      [
        line('ԹԹՎԱՍԵՐ 20%', '9603'),
        // 0403 read with a swap of OCR, and no heading printed: nothing is ruled out
        line('ԹԹՎԱՍԵՐ 20%', '0408'),
        line('ԹԹՎԱՍԵՐ 20%'),
      ],
    )
    expect(bound.map((one) => one.match)).toEqual(['weak', 'search', 'search'])
  })

  it('must not mark an item the seed gave no heading: nothing rules it out', async () => {
    const { items } = fakeItems({
      items: [item(SOUR_CREAM, 'Сметана')],
      near: true,
      nearIds: [SOUR_CREAM],
    })
    const [found] = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('ԹԹՎԱՍԵՐ 20%', '9603'),
    ])
    expect(found).toEqual({ itemId: SOUR_CREAM, match: 'search', translation: 'сметана' })
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

  it('makes a line nothing is found for a new item named in full, «проверьте» (MOL-293, В-1 «а»)', async () => {
    const { items } = fakeItems()
    const bound = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'ru', [
      line('ԹԹՎԱՍԵՐ 20%'),
      line('ՔՍՅԶՔ 77'),
      line('77 15'),
    ])
    expect(bound).toEqual([
      { itemId: null, match: 'weak', translation: 'Сметана 20%', spelled: false },
      // a word the dictionary has not is spelt in letters, and offered as such (В-4)
      { itemId: null, match: 'weak', translation: 'КСЙЗК', spelled: true },
      { itemId: null, match: 'weak', translation: null, spelled: false },
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
    expect(search).toHaveBeenCalledWith('сметана', 10, ACTOR, null)
  })

  it('names no new item in Russian on a receipt read out in English', async () => {
    const { items } = fakeItems()
    const [line0] = await bindReceiptLines({ items, embedder: NO_EMBEDDER }, ACTOR, 'AM', 'en', [
      line('ԹԹՎԱՍԵՐ 20%'),
    ])
    expect(line0).toEqual({ itemId: null, match: 'weak', translation: null, spelled: false })
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
      { items: { nodes, search, byBarcode: NONE }, embedder: NO_EMBEDDER },
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
      {
        items: { nodes: () => Promise.resolve(NODES), search, byBarcode: NONE },
        embedder: NO_EMBEDDER,
      },
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
      {
        items: { nodes: () => Promise.resolve(NODES), search, byBarcode: NONE },
        embedder: NO_EMBEDDER,
      },
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

  it('binds a line by the code the tax office gave it, before the search (MOL-234)', async () => {
    const search = vi.fn<ItemRepository['search']>(() =>
      Promise.resolve({ items: [item(GLUE, 'Клей')], near: true, nearIds: [GLUE] }),
    )
    const byBarcode = vi.fn<ItemRepository['byBarcode']>((codes) =>
      Promise.resolve(codes.includes('8602300236022') ? item(MILK, 'Медено срце') : null),
    )
    const bound = await bindReceiptLines(
      { items: { nodes: () => Promise.resolve(NODES), search, byBarcode }, embedder: NO_EMBEDDER },
      ACTOR,
      'RS',
      'ru',
      [line('Pionir medeno srce 150gr /kom'), line('Zitopek beli hleb /kom'), line('BANANA KG')],
      ['8602300236022', '4006381333931', null],
    )
    // the code nobody holds goes on to the search; a line with none never asks for a code
    expect(byBarcode).toHaveBeenCalledTimes(2)
    expect(byBarcode.mock.calls[0]?.[0][0]).toBe('8602300236022')
    expect(search.mock.calls.map(([query]) => query)).toEqual(['Zitopek beli hleb', 'Banana'])
    expect(bound[0]).toEqual({ itemId: MILK, match: 'search', translation: null })
    expect(bound[1]).toEqual({ itemId: GLUE, match: 'search', translation: null })
  })

  it('an Armenian receipt never asks for a code: it has none (MOL-234)', async () => {
    const byBarcode = vi.fn<ItemRepository['byBarcode']>(NONE)
    const { search } = fakeItems()
    await bindReceiptLines(
      { items: { nodes: () => Promise.resolve(NODES), search, byBarcode }, embedder: NO_EMBEDDER },
      ACTOR,
      'AM',
      'ru',
      [line('Կաթ «Իգիթ» 3.2% 1լ', '0401')],
      ['8602300236022'],
    )
    expect(byBarcode).not.toHaveBeenCalled()
  })
})
