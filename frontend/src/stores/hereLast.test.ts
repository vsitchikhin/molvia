import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogueEntry } from '@molvia/model'
import {
  HERE_LAST_PLACES,
  recallHereLast,
  rememberBoughtHere,
  rememberFinishedHere,
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
    // The eggs were removed afterwards, on another phone; the trip asked about holds nothing, and the
    // screen knows it — so the eggs are not in it, and gone.
    rememberHereLast(
      ME,
      sas,
      trip(2),
      { previous: { tripId: trip(1), at: new Date('2026-10-05T11:00:00Z') }, items: [bread] },
      null,
      [],
    )
    expect(names(recallHereLast(ME, sas, trip(2)))).toEqual(['Хлеб'])
  })

  it('an item added to a finished trip keeps that trip where it stood, not the newest', () => {
    vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') })
    const finished = new Date('2026-10-01T10:00:00Z')
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(1), at: finished },
      items: [eggs],
    })
    rememberBoughtHere(ME, sas, trip(2), milk)
    // Last week's record, a forgotten bread added to it today.
    rememberBoughtHere(ME, sas, trip(1), bread, finished)

    expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко'])
    expect(names(recallHereLast(ME, sas, trip(2)))).toEqual(['Яйца', 'Хлеб'])
  })

  // Adversarial А1г: a receipt's trip is not in the memory; one item added to it is not all of it.
  it('an item added to a finished trip the device does not hold is not written as that trip', () => {
    rememberHereLast(ME, sas, trip(2), {
      previous: { tripId: trip(0), at: new Date('2026-10-01T10:00:00Z') },
      items: [eggs],
    })
    rememberBoughtHere(ME, sas, trip(1), bread, new Date('2026-10-05T10:00:00Z'))

    expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Яйца'])
  })

  // Owner's В-3 «а» of the review, adversarial А1: Monday the bread, Wednesday the milk written here
  // and taken out again — an empty trip is no last time (Р-1) — Friday the server says Monday.
  describe('a trip the server did not count goes with its answer', () => {
    const monday = new Date('2026-10-05T11:00:00Z')
    function wednesdayEmptied(): void {
      vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') })
      rememberHereLast(ME, sas, trip(1), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })
      rememberBoughtHere(ME, sas, trip(1), milk)
      vi.setSystemTime(new Date('2026-10-09T10:00:00Z'))
    }

    it('the trip asked about, with no signal again, is the server’s last time', () => {
      wednesdayEmptied()
      rememberHereLast(ME, sas, trip(2), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })

      expect(names(recallHereLast(ME, sas, trip(2)))).toEqual(['Хлеб'])
      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Хлеб'])
    })

    it('«none» takes every trip before the one asked about — a removed trip was the only one', () => {
      wednesdayEmptied()
      rememberHereLast(ME, sas, trip(2), { previous: null, items: [] })

      expect(recallHereLast(ME, sas, trip(2))).toEqual([])
    })

    it('«must not fire»: the trip asked about keeps what was written into it', () => {
      wednesdayEmptied()
      rememberBoughtHere(ME, sas, trip(2), eggs)
      rememberHereLast(ME, sas, trip(2), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Яйца'])
    })

    it('«must not fire»: a finished trip asked about takes nothing after itself', () => {
      wednesdayEmptied()
      // Wednesday's trip is after the finished Tuesday one asked about: not the server's to judge.
      const tuesday = new Date('2026-10-06T12:00:00Z')
      rememberHereLast(
        ME,
        sas,
        trip(5),
        { previous: { tripId: trip(0), at: monday }, items: [bread] },
        tuesday,
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко'])
      expect(names(recallHereLast(ME, sas, trip(5), tuesday))).toEqual(['Хлеб'])
    })

    // Adversarial Б1: a receipt recorded at the till while a trip typed by hand is still open here —
    // the server did not count that trip for being open, not for being empty.
    it('«must not fire»: a finished trip asked about takes nothing before itself either', () => {
      vi.useFakeTimers({ now: new Date('2026-10-06T10:00:00Z') })
      rememberHereLast(ME, sas, trip(6), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })
      rememberBoughtHere(ME, sas, trip(6), milk)
      const receipt = new Date('2026-10-07T12:00:00Z')
      rememberHereLast(
        ME,
        sas,
        trip(7),
        { previous: { tripId: trip(0), at: monday }, items: [bread] },
        receipt,
      )

      expect(names(recallHereLast(ME, sas, trip(8)))).toEqual(['Молоко'])
    })

    it('boundary: a trip at the very moment the server named is not taken — only those after it', () => {
      rememberHereLast(ME, sas, trip(8), {
        previous: { tripId: trip(4), at: monday },
        items: [eggs],
      })
      rememberHereLast(ME, sas, trip(2), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })

      expect(names(recallHereLast(ME, sas, trip(0)))).toEqual(['Яйца'])
    })
  })

  describe('the trip asked about is kept as the screen holds it (adversarial Б2)', () => {
    const monday = new Date('2026-10-05T11:00:00Z')

    it('the next trip with no signal finds it whole, not the last time less what it holds', () => {
      rememberHereLast(ME, sas, trip(1), {
        previous: { tripId: trip(0), at: monday },
        items: [milk, bread, eggs],
      })
      // Wednesday's receipt took the milk and the bread again: the answer is Monday less them.
      const receipt = new Date('2026-10-07T12:00:00Z')
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [eggs] },
        receipt,
        [milk, bread, milk],
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко', 'Хлеб'])
      // Monday stays whole: what the answer left out is in the receipt. Its own the screen takes out.
      expect(names(recallHereLast(ME, sas, trip(2), receipt))).toEqual(['Молоко', 'Хлеб', 'Яйца'])
    })

    it('a last time held whole is not cut by an answer about another trip — the trip’s rows unknown', () => {
      rememberHereLast(ME, sas, trip(1), {
        previous: { tripId: trip(0), at: monday },
        items: [milk, bread, eggs],
      })
      // A trip filled on another device: the answer is Monday less what it holds, the rows not known.
      rememberHereLast(ME, sas, trip(2), {
        previous: { tripId: trip(0), at: monday },
        items: [eggs],
      })

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко', 'Хлеб', 'Яйца'])
    })

    it('what the answer leaves out and the trip does not hold is gone — removed since', () => {
      rememberHereLast(ME, sas, trip(1), {
        previous: { tripId: trip(0), at: monday },
        items: [milk, bread, eggs],
      })
      // The trip asked about holds the milk; the bread was taken out of Monday since.
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [eggs] },
        new Date('2026-10-07T12:00:00Z'),
        [milk],
      )

      expect(names(recallHereLast(ME, sas, trip(2), new Date('2026-10-07T12:00:00Z')))).toEqual([
        'Молоко',
        'Яйца',
      ])
    })

    it('what the device did not hold of the last time stands in the answer’s order', () => {
      rememberHereLast(ME, sas, trip(1), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [milk, bread, eggs] },
        null,
        [],
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко', 'Хлеб', 'Яйца'])
    })

    it('what the screen holds takes the place of what was written into it — a removal too', () => {
      vi.useFakeTimers({ now: new Date('2026-10-07T10:00:00Z') })
      rememberBoughtHere(ME, sas, trip(2), milk)
      rememberBoughtHere(ME, sas, trip(2), eggs)
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [bread] },
        null,
        [milk],
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко'])
    })

    it('«must not fire»: a screen that knows none of the trip’s rows writes no trip', () => {
      rememberHereLast(ME, sas, trip(2), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Хлеб'])
    })
  })

  describe('a finished trip asked about, beside the trip going on (adversarial В2, m5 of review 3)', () => {
    const monday = new Date('2026-10-05T11:00:00Z')
    const printed = new Date('2026-10-07T10:20:00Z')

    it('the trip going on stays the newest: it is finished after any finished trip', () => {
      vi.useFakeTimers({ now: new Date('2026-10-06T10:05:00Z') })
      rememberBoughtHere(ME, sas, trip(1), milk)
      vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [bread] },
        printed,
        [eggs],
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко'])
    })

    it('a trip finished here stands at its finish: finished before the receipt’s paper, the receipt is newer', () => {
      vi.useFakeTimers({ now: new Date('2026-10-06T10:05:00Z') })
      rememberBoughtHere(ME, sas, trip(1), milk)
      rememberFinishedHere(ME, trip(1).toUpperCase(), new Date('2026-10-06T11:00:00Z'))
      vi.setSystemTime(new Date('2026-10-10T12:00:00Z'))
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [bread] },
        printed,
        [eggs],
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Яйца'])
    })

    it('finished after the receipt’s paper, the trip finished here stays the newest', () => {
      vi.useFakeTimers({ now: new Date('2026-10-06T10:05:00Z') })
      rememberBoughtHere(ME, sas, trip(1), milk)
      vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(0), at: monday }, items: [bread] },
        printed,
        [eggs],
      )
      rememberFinishedHere(ME, trip(1), new Date('2026-10-09T18:00:00Z'))

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Молоко'])
    })

    it('a finished trip is kept at its own moment, not at the moment it was asked about', () => {
      rememberHereLast(ME, sas, trip(9), {
        previous: { tripId: trip(0), at: monday },
        items: [bread],
      })
      vi.useFakeTimers({ now: new Date('2026-10-08T12:00:00Z') })
      // A September receipt recorded and opened today: its last time is in August.
      rememberHereLast(
        ME,
        sas,
        trip(2),
        { previous: { tripId: trip(4), at: new Date('2026-08-20T10:00:00Z') }, items: [eggs] },
        new Date('2026-09-07T10:20:00Z'),
        [milk],
      )

      expect(names(recallHereLast(ME, sas, trip(3)))).toEqual(['Хлеб'])
    })
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
