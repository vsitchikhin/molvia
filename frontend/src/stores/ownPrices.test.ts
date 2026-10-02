import { beforeEach, describe, expect, it } from 'vitest'
import type { OwnPricesResponse } from '@molvia/model'
import {
  OWN_PRICES_REMEMBERED,
  forgetOwnPrices,
  recallOwnPrices,
  rememberOwnPrices,
} from '@/stores/ownPrices'

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const MILK = 'dddddddd-0000-4000-8000-000000000001'
const MARIANNA = 'dddddddd-0000-4000-8000-000000000002'
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

function answer(itemId: string, alternatives: string[] = []): OwnPricesResponse {
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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('the memory of «Тут дешевле» (MOL-92, В-5)', () => {
  it('gives back the answer for the item and city, the unit price whole', () => {
    rememberOwnPrices(ME, MILK, erevan, answer(MILK))

    expect(recallOwnPrices(ME, MILK.toUpperCase(), erevan)).toEqual(answer(MILK))
    expect(recallOwnPrices(ME, MILK, gyumri)).toBeNull()
    expect(recallOwnPrices(null, MILK, erevan)).toBeNull()
    expect(localStorage.getItem(`molvia.own-prices.${ME}`)).not.toBeNull()
  })

  it(`keeps the last ${String(OWN_PRICES_REMEMBERED)}, the oldest going first`, () => {
    const id = (n: number) => `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`
    for (let n = 0; n <= OWN_PRICES_REMEMBERED; n += 1)
      rememberOwnPrices(ME, id(n), erevan, answer(id(n)))

    expect(recallOwnPrices(ME, id(0), erevan)).toBeNull()
    expect(recallOwnPrices(ME, id(1), erevan)).not.toBeNull()
    expect(recallOwnPrices(ME, id(OWN_PRICES_REMEMBERED), erevan)).not.toBeNull()
  })

  it('lets go of every answer naming an item rated here — as itself or as another of its kind', () => {
    const OTHER = 'dddddddd-0000-4000-8000-000000000003'
    rememberOwnPrices(ME, MILK, erevan, answer(MILK, [MARIANNA]))
    rememberOwnPrices(ME, MARIANNA, gyumri, answer(MARIANNA))
    rememberOwnPrices(ME, OTHER, erevan, answer(OTHER))

    forgetOwnPrices(ME, MARIANNA)

    expect(recallOwnPrices(ME, MILK, erevan)).toBeNull()
    expect(recallOwnPrices(ME, MARIANNA, gyumri)).toBeNull()
    expect(recallOwnPrices(ME, OTHER, erevan)).not.toBeNull()
  })

  it('reads past an entry an older version wrote differently', () => {
    localStorage.setItem(
      `molvia.own-prices.${ME}`,
      JSON.stringify([{ slot: 'x', answer: { level: 'nonsense' } }, 'junk']),
    )
    rememberOwnPrices(ME, MILK, erevan, answer(MILK))

    expect(recallOwnPrices(ME, MILK, erevan)).toEqual(answer(MILK))
  })
})
