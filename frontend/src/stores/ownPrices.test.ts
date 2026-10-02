import { beforeEach, describe, expect, it } from 'vitest'
import type { OwnPrices } from '@molvia/model'
import {
  OWN_PRICES_REMEMBERED,
  RECORD_CITIES_REMEMBERED,
  forgetOwnPrices,
  recallOwnPrices,
  recallRecordCity,
  rememberOwnPrices,
  rememberRecordCity,
} from '@/stores/ownPrices'

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MILK = 'dddddddd-0000-4000-8000-000000000001'
const MARIANNA = 'dddddddd-0000-4000-8000-000000000002'
const OTHER = 'dddddddd-0000-4000-8000-000000000003'
const ZOVUNI = 'cccccccc-0000-4000-8000-000000000001'
const erevan = { country: 'AM', city: 'Ереван' } as const
const gyumri = { country: 'AM', city: 'Гюмри' } as const

const place = {
  placeId: ZOVUNI,
  name: 'Зовуни',
  unitPrice: { scaledMinor: 54_000_000_000n, currency: 'AMD' as const, unit: 'l' as const },
  day: '2026-09-12',
  observations: 2,
}

function answer(itemId: string, alternatives: string[] = []): OwnPrices {
  return {
    itemId,
    level: 'unrated',
    places: [place],
    alternatives: alternatives.map((id) => ({
      itemId: id,
      name: 'Молоко Марианна',
      level: 'take',
      rating: '4.5',
      places: [place],
    })),
  }
}

const id = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('the memory of «Тут дешевле» (MOL-92, В-5)', () => {
  it('gives back the answer for the item and city, the unit price whole', () => {
    rememberOwnPrices(ME, MILK, erevan, answer(MILK), Date.now())

    expect(recallOwnPrices(ME, MILK.toUpperCase(), erevan)).toEqual(answer(MILK))
    expect(recallOwnPrices(ME, MILK, gyumri)).toBeNull()
    expect(recallOwnPrices(null, MILK, erevan)).toBeNull()
    expect(localStorage.getItem(`molvia.own-prices.${ME}`)).not.toBeNull()
  })

  it(`keeps the last ${String(OWN_PRICES_REMEMBERED)} answers, the oldest going first`, () => {
    for (let n = 0; n <= OWN_PRICES_REMEMBERED; n += 1) {
      rememberOwnPrices(ME, id(n), erevan, answer(id(n)), Date.now())
    }

    expect(recallOwnPrices(ME, id(0), erevan)).toBeNull()
    expect(recallOwnPrices(ME, id(1), erevan)).not.toBeNull()
    expect(recallOwnPrices(ME, id(OWN_PRICES_REMEMBERED), erevan)).not.toBeNull()
  })

  it(`knows the city of the last ${String(RECORD_CITIES_REMEMBERED)} records it was answered for (review №1)`, () => {
    for (let n = 0; n <= RECORD_CITIES_REMEMBERED; n += 1) {
      rememberRecordCity(ME, id(n), n === 1 ? gyumri : erevan)
    }

    expect(recallRecordCity(ME, id(0))).toBeNull()
    expect(recallRecordCity(ME, id(1).toUpperCase())).toEqual(gyumri)
    expect(recallRecordCity(null, id(1))).toBeNull()
  })

  it('lets go of every answer naming an item rated — as itself or as another of its kind', () => {
    rememberOwnPrices(ME, MILK, erevan, answer(MILK, [MARIANNA]), Date.now())
    rememberOwnPrices(ME, MARIANNA, gyumri, answer(MARIANNA), Date.now())
    rememberOwnPrices(ME, OTHER, erevan, answer(OTHER), Date.now())

    forgetOwnPrices(ME, [MARIANNA])

    expect(recallOwnPrices(ME, MILK, erevan)).toBeNull()
    expect(recallOwnPrices(ME, MARIANNA, gyumri)).toBeNull()
    expect(recallOwnPrices(ME, OTHER, erevan)).not.toBeNull()
  })

  it('drops an answer asked before a verdict let go of something, whenever it lands (adversarial В)', () => {
    const askedAt = Date.now() - 1000
    forgetOwnPrices(ME, [MARIANNA])

    rememberOwnPrices(ME, MILK, erevan, answer(MILK, [MARIANNA]), askedAt)
    expect(recallOwnPrices(ME, MILK, erevan)).toBeNull()

    rememberOwnPrices(ME, MILK, erevan, answer(MILK), Date.now() + 1)
    expect(recallOwnPrices(ME, MILK, erevan)).not.toBeNull()
  })

  it('a list read lets go of what it names and leaves answers on their way alone', () => {
    const askedAt = Date.now() - 1000
    rememberOwnPrices(ME, MILK, erevan, answer(MILK, [MARIANNA]), askedAt)
    forgetOwnPrices(ME, [MARIANNA], { rated: false })
    expect(recallOwnPrices(ME, MILK, erevan)).toBeNull()

    rememberOwnPrices(ME, OTHER, erevan, answer(OTHER), askedAt)
    expect(recallOwnPrices(ME, OTHER, erevan)).not.toBeNull()
  })

  it('reads past an entry or a record an older build wrote differently', () => {
    localStorage.setItem(
      `molvia.own-prices.${ME}`,
      JSON.stringify({
        entries: [{ slot: 'x', prices: { level: 'nonsense' } }, 'junk'],
        records: [{ tripId: MILK }],
        forgotAt: 'yesterday',
      }),
    )
    rememberOwnPrices(ME, MILK, erevan, answer(MILK), 0)

    expect(recallOwnPrices(ME, MILK, erevan)).toEqual(answer(MILK))
  })
})
