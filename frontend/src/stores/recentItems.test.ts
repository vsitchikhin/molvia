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
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    store.remember(milk)
    store.sync()

    expect(store.items.map((item) => item.id)).toEqual([milk.id, bread.id])
  })

  it('remembers for the session when storage refuses every write', () => {
    const store = relaunched()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

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
