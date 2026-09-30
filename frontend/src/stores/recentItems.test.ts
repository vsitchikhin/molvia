import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { CatalogueEntry } from '@molvia/model'
import { RECENT_LIMIT, useRecentItemsStore } from '@/stores/recentItems'

let identity: string | null = null
vi.mock('@/stores/identity', () => ({ currentIdentity: () => identity }))

const FIRST = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const SECOND = '2c4e6a80-1111-4222-8333-444455556666'

function entry(n: number, fields: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    id: `0b6f2c4e-8d1a-4f3b-9c7e-${String(n).padStart(12, '0')}`,
    kind: 'product',
    name: `Позиция ${String(n)}`,
    note: null,
    defaultUnit: 'piece',
    typicalQuantity: null,
    ...fields,
  }
}

const milk = entry(1, {
  name: 'Молоко «Ашхар»',
  note: 'ультрапастеризованное, 2,5%',
  defaultUnit: 'l',
  typicalQuantity: { milli: 900n, unit: 'l' },
})
const bread = entry(2, { name: 'Хлеб «Гюмри»', note: 'формовой' })
const matsun = entry(3, { name: 'Matsun «Marianna»' })

/**
 * A shelf that refuses every write, until the test is over. An own property, as `actor.test.ts`
 * does it: happy-dom keeps `setItem` there, and `restoreAllMocks` never took a `vi.spyOn` off it —
 * every later test of this file wrote nowhere, and a relaunch read nothing back.
 */
const refusals: (() => void)[] = []
function refusing(shelf: Storage, error: Error): void {
  const working = shelf.setItem.bind(shelf)
  const define = (value: Storage['setItem']) =>
    Object.defineProperty(shelf, 'setItem', { configurable: true, writable: true, value })
  define(() => {
    throw error
  })
  refusals.push(() => {
    define(working)
  })
}

/** A fresh store over whatever storage holds — what the next launch of the app sees. */
function relaunched() {
  setActivePinia(createPinia())
  const store = useRecentItemsStore()
  store.sync()
  return store
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  identity = FIRST
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const restore of refusals.splice(0)) restore()
})

describe('recent items', () => {
  it('keeps the newest first and survives a relaunch, quantity included', () => {
    const store = relaunched()
    store.remember(milk)
    store.remember(bread)

    const again = relaunched()

    expect(again.items.map((item) => item.name)).toEqual([bread.name, milk.name])
    expect(again.items[1]).toEqual(milk)
  })

  it('moves an item taken again to the top instead of listing it twice', () => {
    const store = relaunched()
    store.remember(milk)
    store.remember(bread)
    store.remember(milk)

    expect(store.items.map((item) => item.id)).toEqual([milk.id, bread.id])
  })

  it(`holds exactly ${String(RECENT_LIMIT)}: the next one pushes the oldest out`, () => {
    const store = relaunched()
    for (let n = 1; n <= RECENT_LIMIT; n += 1) store.remember(entry(100 + n))
    expect(store.items).toHaveLength(RECENT_LIMIT)
    expect(store.items.at(-1)?.id).toBe(entry(101).id)

    store.remember(entry(999))

    expect(store.items).toHaveLength(RECENT_LIMIT)
    expect(store.items[0]?.id).toBe(entry(999).id)
    expect(store.items.map((item) => item.id)).not.toContain(entry(101).id)
  })

  it('belongs to the identity: another one sees its own list, and the first is still there', () => {
    const store = relaunched()
    store.remember(milk)

    identity = SECOND
    store.sync()
    expect(store.items).toEqual([])
    store.remember(bread)

    identity = FIRST
    store.sync()
    expect(store.items.map((item) => item.id)).toEqual([milk.id])
  })

  it('is empty, and writes nothing, before the device has an identity', () => {
    identity = null
    const store = relaunched()
    store.remember(milk)

    expect(localStorage.length).toBe(0)
    identity = FIRST
    store.sync()
    expect(store.items).toEqual([])
  })

  it('reads storage it cannot understand as no list, not as a crash', () => {
    for (const raw of ['{', '"строка"', '{"items":[]}', '42']) {
      localStorage.setItem(`molvia.recent.${FIRST}`, raw)
      expect(relaunched().items, raw).toEqual([])
    }
  })

  it('drops only the rows it cannot read', () => {
    const store = relaunched()
    for (const item of [milk, bread, matsun]) store.remember(item)
    const key = `molvia.recent.${FIRST}`
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]
    localStorage.setItem(
      key,
      JSON.stringify([
        rows[0],
        { id: 'not-an-id' },
        rows[1],
        null,
        { ...(rows[2] as object), createdBy: FIRST },
      ]),
    )

    // The row with a field beyond the card is dropped as well: the codec is strict, and a card
    // that grew a field is how a leak would otherwise travel unnoticed (MOL-12).
    expect(relaunched().items.map((item) => item.id)).toEqual([matsun.id, bread.id])
  })

  it('keeps what another window of the app added — the installed app and a tab share storage', () => {
    const pwa = relaunched()
    setActivePinia(createPinia())
    const tab = useRecentItemsStore()
    tab.sync()

    pwa.remember(milk)
    tab.remember(bread)

    expect(relaunched().items.map((item) => item.id)).toEqual([bread.id, milk.id])
  })

  it('shows what another window added the next time the list is shown', () => {
    const shown = relaunched()
    const other = relaunched()
    other.remember(bread)

    shown.sync()

    expect(shown.items.map((item) => item.id)).toEqual([bread.id])
  })

  it('keeps what it wrote when a full localStorage refuses it and sessionStorage takes it', () => {
    const store = relaunched()
    store.remember(bread)
    refusing(localStorage, new DOMException('quota', 'QuotaExceededError'))

    store.remember(milk)
    store.sync()

    expect(store.items.map((item) => item.id)).toEqual([milk.id, bread.id])
  })

  it('remembers for the session when storage refuses every write', () => {
    const store = relaunched()
    refusing(localStorage, new Error('QuotaExceededError'))
    refusing(sessionStorage, new Error('QuotaExceededError'))

    store.remember(milk)
    store.sync()

    expect(store.items.map((item) => item.id)).toEqual([milk.id])
  })

  describe('narrowed offline', () => {
    function withThree() {
      const store = relaunched()
      for (const item of [milk, bread, matsun]) store.remember(item)
      return store
    }

    it('by a part of the name, in any case', () => {
      expect(
        withThree()
          .filter('МОЛ')
          .map((item) => item.id),
      ).toEqual([milk.id])
    })

    it('by the note — what tells two items apart on the shelf', () => {
      expect(
        withThree()
          .filter('формов')
          .map((item) => item.id),
      ).toEqual([bread.id])
    })

    it('as typed, with no transliteration: that is the catalogue’s job, and it is offline', () => {
      const store = withThree()
      expect(store.filter('matsun').map((item) => item.id)).toEqual([matsun.id])
      expect(store.filter('мацун')).toEqual([])
    })

    it('by the search’s dictionary: «картошка» finds «Картофель», a whole word and nothing less', () => {
      const store = relaunched()
      const potato = entry(4, { name: 'Картофель молодой' })
      const puree = entry(5, { name: 'Картофельное пюре' })
      for (const item of [potato, puree]) store.remember(item)
      expect(store.filter('картошка').map((item) => item.id)).toEqual([potato.id])
      // An unfinished word is not looked up, as the search does not look it up.
      expect(store.filter('картош')).toEqual([])
    })

    it('by the dictionary as the server reads it: the kind first, and a pair for every word (review Д)', () => {
      const store = relaunched()
      const nectar = entry(6, { name: 'Нектар персиковый 1 л' })
      const toilet = entry(7, { name: 'Туалетная вода Hugo Boss' })
      const water = entry(8, { name: 'Вода минеральная Джермук' })
      const young = entry(9, { name: 'Молодой картофель' })
      for (const item of [nectar, toilet, water, young]) store.remember(item)
      expect(store.filter('сок').map((item) => item.id)).toEqual([nectar.id])
      expect(store.filter('сок персиковый').map((item) => item.id)).toEqual([nectar.id])
      expect(store.filter('сок яблочный')).toEqual([])
      expect(store.filter('минералка').map((item) => item.id)).toEqual([water.id])
      expect(store.filter('картошка').map((item) => item.id)).toEqual([young.id])
    })

    it('takes an adjective of a group beside a kind of its own only: «Лапша гречневая» is no «гречка» (review С, Ц)', () => {
      const store = relaunched()
      const noodles = entry(10, { name: 'Лапша гречневая Sen Soy' })
      const buckwheat = entry(11, { name: 'Гречневая крупа' })
      const groats = entry(12, { name: 'Крупа гречневая ядрица' })
      const soba = entry(13, { name: 'Гречневая лапша' })
      for (const item of [noodles, buckwheat, groats, soba]) store.remember(item)
      // Beside the groats it is the groats, in either order; beside the noodles, the noodles.
      expect(
        store
          .filter('гречка')
          .map((item) => item.id)
          .sort(),
      ).toEqual([buckwheat.id, groats.id].sort())
      expect(store.filter('гречневая')).toHaveLength(4)
    })

    it('not at all under an empty or blank query', () => {
      const store = withThree()
      expect(store.filter('')).toHaveLength(3)
      expect(store.filter('   ')).toHaveLength(3)
    })

    it('not at all under a query that draws nothing — the search calls it empty, and so does this', () => {
      const store = withThree()
      expect(store.filter(String.fromCodePoint(0x200b))).toHaveLength(3)
      expect(store.filter(String.fromCodePoint(0x2060, 0x20))).toHaveLength(3)
    })

    it('past what draws nothing inside the query', () => {
      const zwsp = String.fromCodePoint(0x200b)
      expect(
        withThree()
          .filter(`хлеб${zwsp}`)
          .map((item) => item.id),
      ).toEqual([bread.id])
    })

    it('trimmed at the edges, like the question «is it empty»', () => {
      expect(
        withThree()
          .filter('  хлеб ')
          .map((item) => item.id),
      ).toEqual([bread.id])
    })
  })
})

describe('the codes recent items were found by (MOL-99)', () => {
  it('finds an item by the code it was found by, after a relaunch', () => {
    relaunched().remember(milk, '4850000000007')

    const again = relaunched()

    expect(again.byCode('4850000000007')).toEqual(milk)
    expect(again.byCode('4850000000014')).toBeNull()
  })

  it('finds it by the other form of an ambiguous code, as the server looks it up (С-14)', () => {
    const store = relaunched()
    store.remember(bread, '00408295')

    // Scanned from the shop label it was eight digits; typed from it, thirteen.
    expect(store.byCode('0004082000095')).toEqual(bread)
  })

  it('keeps the code of an item taken again without one', () => {
    const store = relaunched()
    store.remember(milk, '4850000000007')
    store.remember(milk)

    expect(relaunched().byCode('4850000000007')).toEqual(milk)
  })

  it('forgets a code let go of by its item, in any of its forms — the item stays (MOL-100)', () => {
    const store = relaunched()
    store.remember(bread, '00408295')
    store.remember(milk, '4850000000007')

    store.forgetCode('0004082000095')

    const again = relaunched()
    expect(again.byCode('00408295')).toBeNull()
    expect(again.byCode('4850000000007')).toEqual(milk)
    expect(again.items.map((item) => item.id)).toContain(bread.id)
  })

  it('forgets the code once its item falls off the list', () => {
    const store = relaunched()
    store.remember(milk, '4850000000007')
    for (let n = 10; n < 10 + RECENT_LIMIT; n++) store.remember(entry(n))

    const again = relaunched()

    expect(again.byCode('4850000000007')).toBeNull()
    expect(JSON.parse(localStorage.getItem(`molvia.recent-codes.${FIRST}`) ?? '')).toEqual({})
  })

  it('must not find an item by a code of no barcode shape', () => {
    const store = relaunched()
    store.remember(milk, '4850000000007')

    expect(store.byCode('')).toBeNull()
    expect(store.byCode('485000000000')).toBeNull()
  })

  it('belongs to the identity, as the list does', () => {
    relaunched().remember(milk, '4850000000007')
    identity = SECOND

    expect(relaunched().byCode('4850000000007')).toBeNull()
  })

  it('leaves the rows of the list as an older version reads them', () => {
    relaunched().remember(matsun, '4850000000007')

    const rows = JSON.parse(localStorage.getItem(`molvia.recent.${FIRST}`) ?? '') as object[]
    expect(rows.map((row) => Object.keys(row).sort())).toEqual([
      ['defaultUnit', 'id', 'kind', 'name', 'note', 'typicalQuantity'],
    ])
  })

  it('reads stored codes it cannot understand as none, not as a crash', () => {
    relaunched().remember(milk, '4850000000007')
    for (const garbage of ['{', '[]', '"x"', '{"4850000000007":5}']) {
      localStorage.setItem(`molvia.recent-codes.${FIRST}`, garbage)
      expect(relaunched().byCode('4850000000007'), garbage).toBeNull()
    }
  })
})
