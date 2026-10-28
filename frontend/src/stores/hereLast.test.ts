import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogueEntry } from '@molvia/model'
import {
  HERE_LAST_PLACES,
  recallHereLast,
  rememberBoughtHere,
  rememberHereLast,
} from '@/stores/hereLast'

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const SOMEONE = '1a2b3c4d-4e2a-4b6f-8c3d-9f1b8c7d6e5f'
const trip = (n: number) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`

function entry(n: number, name: string): CatalogueEntry {
  return {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind: 'product',
    name,
    note: null,
    defaultUnit: 'piece',
    typicalQuantity: null,
  }
}

const milk = entry(1, 'Молоко')
const bread = entry(2, 'Хлеб')
const eggs = entry(3, 'Яйца')
const sas = { city: 'Гюмри', name: 'SAS' }

const names = (items: readonly CatalogueEntry[] | null) => items?.map((item) => item.name) ?? null

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useRealTimers()
})

describe('«Брали здесь в прошлый раз» on the device (MOL-209)', () => {
  it('knows nothing of a place it was never told about', () => {
    expect(recallHereLast(ME, sas, trip(2))).toBeNull()
    expect(recallHereLast(null, sas, trip(2))).toBeNull()
  })

  it('answers the server’s last time for the trip it was asked about', () => {
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-01T10:00:00Z') },
      items: [bread, eggs],
    })
    expect(names(recallHereLast(ME, sas, trip(2).toUpperCase()))).toEqual(['Хлеб', 'Яйца'])
  })

  it('a place is its city and name as the database folds them, and one name in two cities is two', () => {
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-01') },
      items: [bread],
    })
    expect(names(recallHereLast(ME, { city: 'Гюмри', name: ' SAS ' }, trip(2)))).toEqual(['Хлеб'])
    expect(recallHereLast(ME, { city: 'Ереван', name: 'SAS' }, trip(2))).toBeNull()
  })

  it('«none» from the server is known as none for that trip, not for the next one', () => {
    rememberHereLast(ME, sas, trip(1), { previous: null, items: [] })
    expect(recallHereLast(ME, sas, trip(1))).toEqual([])
    expect(recallHereLast(ME, sas, trip(2))).toBeNull()
  })

  // В-1 «а»: Monday with a signal, Wednesday with a signal, Friday with none — Friday is Wednesday.
  it('with no signal the next trip finds the one written here, not the one before it', () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T10:00:00Z') })
    rememberHereLast(ME, sas, trip(1), { previous: null, items: [] })
    rememberBoughtHere(ME, sas, trip(1), bread)
    rememberBoughtHere(ME, sas, trip(1), eggs)

    vi.setSystemTime(new Date('2026-10-07T10:00:00Z'))
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-05T11:00:00Z') },
      items: [bread, eggs],
    })
    rememberBoughtHere(ME, sas, trip(2), milk)
    rememberBoughtHere(ME, sas, trip(2), milk)

    // Friday's trip, never sent: Wednesday is its last time.
    expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко'])
    // And on Wednesday, still, Monday.
    expect(names(recallHereLast(ME, sas, trip(2)))).toEqual(['Хлеб', 'Яйца'])
  })

  it('the server’s answer takes the place of what the phone wrote into that trip', () => {
    vi.useFakeTimers({ now: new Date('2026-10-05T10:00:00Z') })
    rememberBoughtHere(ME, sas, trip(1), bread)
    rememberBoughtHere(ME, sas, trip(1), eggs)
    // The eggs were removed afterwards, on another phone.
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-05T11:00:00Z') },
      items: [bread],
    })
    expect(names(recallHereLast(ME, sas, trip(2)))).toEqual(['Хлеб'])
  })

  it('a finished trip looks only before itself', () => {
    rememberHereLast(ME, sas, trip(3), {
      previous: { tripId: trip(2), at: new Date('2026-10-07') },
      items: [milk],
    })
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-05') },
      items: [bread],
    })
    expect(names(recallHereLast(ME, sas, trip(2), new Date('2026-10-07')))).toEqual(['Хлеб'])
    expect(recallHereLast(ME, sas, trip(1), new Date('2026-10-05'))).toBeNull()
  })

  it('is each owner’s own', () => {
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-01') },
      items: [bread],
    })
    expect(recallHereLast(SOMEONE, sas, trip(2))).toBeNull()
    expect(localStorage.getItem(`molvia.here-last.${SOMEONE}`)).toBeNull()
    expect(localStorage.getItem(`molvia.here-last.${ME}`)).not.toBeNull()
  })

  it.each([HERE_LAST_PLACES - 1, HERE_LAST_PLACES, HERE_LAST_PLACES + 1])(
    'keeps the %i places used last, the oldest let go',
    (count) => {
      for (let n = 0; n < count; n += 1) {
        rememberHereLast(ME, { city: 'Гюмри', name: `Магазин ${String(n)}` }, trip(2), {
          previous: { tripId: trip(1), at: new Date('2026-10-01') },
          items: [bread],
        })
      }
      const first = recallHereLast(ME, { city: 'Гюмри', name: 'Магазин 0' }, trip(2))
      expect(first === null).toBe(count > HERE_LAST_PLACES)
      const last = { city: 'Гюмри', name: `Магазин ${String(count - 1)}` }
      expect(names(recallHereLast(ME, last, trip(2)))).toEqual(['Хлеб'])
    },
  )

  it('a row an older version wrote differently costs only itself', () => {
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: new Date('2026-10-01') },
      items: [bread, eggs],
    })
    const key = `molvia.here-last.${ME}`
    const stored = JSON.parse(localStorage.getItem(key) ?? '[]') as {
      trips: { items: unknown[] }[]
    }[]
    stored[0]?.trips[0]?.items.splice(0, 1, { name: 'без id' })
    localStorage.setItem(key, JSON.stringify([{ slot: 'мусор' }, ...stored, 42]))

    expect(names(recallHereLast(ME, sas, trip(2)))).toEqual(['Яйца'])
    localStorage.setItem(key, '{not json')
    expect(recallHereLast(ME, sas, trip(2))).toBeNull()
  })
})
