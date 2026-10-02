import { describe, expect, it } from 'vitest'
import type { OwnAlternative, OwnPlacePrice, OwnPrices } from '#model/contracts/advice'
import { cheaperHint } from '#model/entities/cheaper-hint'
import type { CheaperHintInput } from '#model/entities/cheaper-hint'
import { UNIT_PRICE_SCALE, unitPrice } from '#model/values/units'
import type { BaseUnit, UnitPrice } from '#model/values/units'
import type { Currency } from '#model/values/money'

const ITEM = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const ZOVUNI = '2b7a1f30-5c8d-4a2e-9f11-6d3c8e0b4a57'
const CITY = '9d1e2f30-4a5b-4c6d-8e7f-0a1b2c3d4e5f'
const MARIANNA = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const ANELIK = '6f5e4d3c-2b1a-4f9e-8d7c-6b5a4f3e2d1c'

function per(amount: number, unit: BaseUnit = 'l', currency: Currency = 'AMD'): UnitPrice {
  return { scaledMinor: BigInt(amount) * 100n * UNIT_PRICE_SCALE, currency, unit }
}

function place(
  placeId: string,
  amount: number,
  {
    unit = 'l',
    currency = 'AMD',
    day = '2026-09-12',
  }: { unit?: BaseUnit; currency?: Currency; day?: string } = {},
): OwnPlacePrice {
  return {
    placeId,
    name: placeId === ZOVUNI ? 'Зовуни' : 'Ереван Сити',
    unitPrice: per(amount, unit, currency),
    quantity: { milli: 1000n, unit },
    day,
    observations: 1,
  }
}

function alternative(
  itemId: string,
  rating: string,
  places: OwnPlacePrice[],
  level: 'take' | 'if_cheap' = Number(rating) >= 4 ? 'take' : 'if_cheap',
): OwnAlternative {
  return {
    itemId,
    name: itemId === MARIANNA ? 'Молоко Марианна' : 'Молоко Анелик',
    level,
    rating,
    places,
  }
}

function rated(
  places: OwnPlacePrice[],
  alternatives: OwnAlternative[] = [],
  rating = '4.0',
): OwnPrices {
  return { itemId: ITEM, level: 'take', rating, places, alternatives }
}

function hint(answer: OwnPrices, typed: number | null, extra: Partial<CheaperHintInput> = {}) {
  return cheaperHint({
    answer,
    currency: 'AMD',
    unit: 'l',
    typed: typed === null ? null : per(typed),
    typedQuantity: null,
    here: CITY,
    ...extra,
  })
}

describe('cheaperHint · the item itself', () => {
  const history = rated([place(ZOVUNI, 540), place(CITY, 600, { day: '2026-09-03' })])

  it('names the cheapest place plainly before a price is typed (В-1)', () => {
    expect(hint(history, null).item).toMatchObject({
      kind: 'best',
      place: { placeId: ZOVUNI },
      here: false,
    })
  })

  it('names where it was cheaper when the price typed is dearer — the example of the task', () => {
    expect(hint(history, 620).item).toMatchObject({ kind: 'there', place: { placeId: ZOVUNI } })
  })

  it('says «как в …» at that price and within half a per cent of it, else «дешевле» or «дороже» (В-2)', () => {
    expect(hint(history, 540).item?.kind).toBe('same')
    // 540 × 1,005 = 542,70: 542 is the same tag, 543 and 537 are not.
    expect(hint(history, 542).item?.kind).toBe('same')
    expect(hint(history, 538).item?.kind).toBe('same')
    expect(hint(history, 543).item?.kind).toBe('there')
    expect(hint(history, 537).item?.kind).toBe('cheaper')
  })

  describe('one tag of loose goods is one price, whatever the till’s rounding (adversarial Г, Г′)', () => {
    const grams = (milli: number) => ({ milli: BigInt(milli), unit: 'kg' as const })
    const paid = (amount: number, milli: number): UnitPrice =>
      unitPrice({ minor: BigInt(amount) * 100n, currency: 'AMD' }, grams(milli))
    const weighed = (amount: number, milli: number): OwnPlacePrice => ({
      ...place(CITY, 0, { unit: 'kg' }),
      unitPrice: paid(amount, milli),
      quantity: grams(milli),
    })
    const typed = (amount: number, milli: number) => ({
      typed: paid(amount, milli),
      typedQuantity: grams(milli),
    })

    it('690 ֏/кг: 1,234 kg for 851 last time, and 0,611 / 0,876 / 1,050 / 0,15 kg now', () => {
      const tomatoes = rated([weighed(851, 1234)])
      for (const [amount, milli] of [
        [422, 611],
        [604, 876],
        [725, 1050],
        // 103,50 paid 104 — 693,33 ֏/кг: half a per cent does not hold it, the till's half a dram does.
        [104, 150],
      ] as const) {
        expect(hint(tomatoes, null, typed(amount, milli)).item?.kind).toBe('same')
      }
    })

    it('800 ֏/кг of parsley: 0,25 kg for 200, then 0,083 kg for 66', () => {
      expect(hint(rated([weighed(200, 250)]), null, typed(66, 83)).item?.kind).toBe('same')
    })

    it('still tells a price that moved: 104 ֏ for 0,15 kg against 800 ֏/кг', () => {
      // 693,33 against 800: far past what rounding can do.
      expect(hint(rated([weighed(200, 250)]), null, typed(104, 150)).item?.kind).toBe('cheaper')
    })

    it('a till of cents wobbles by cents: euros and dollars tell a price apart (adversarial Г″)', () => {
      const cents = (minor: number, milli: number, currency: Currency): UnitPrice =>
        unitPrice({ minor: BigInt(minor), currency }, { milli: BigInt(milli), unit: 'l' })
      const litre = (minor: number, currency: Currency): OwnPlacePrice => ({
        ...place(ZOVUNI, 0, { currency }),
        unitPrice: cents(minor, 1000, currency),
      })
      const typedIn = (minor: number, milli: number, currency: Currency) => ({
        currency,
        typed: cents(minor, milli, currency),
        typedQuantity: { milli: BigInt(milli), unit: 'l' as const },
      })

      // €1,19 a litre at Зовуни; €1,79 now is half as dear again.
      expect(hint(rated([litre(119, 'EUR')]), null, typedIn(179, 1000, 'EUR')).item?.kind).toBe(
        'there',
      )
      // A cent of rounding on a litre is still one price.
      expect(hint(rated([litre(119, 'EUR')]), null, typedIn(120, 1000, 'EUR')).item?.kind).toBe(
        'same',
      )
      // 0,2 kg for $1,60 — $8/kg — against $10,90 for 1 kg: a third dearer there, not the same.
      const cheese = rated([
        {
          ...place(ZOVUNI, 0, { unit: 'kg', currency: 'USD' }),
          unitPrice: unitPrice({ minor: 1090n, currency: 'USD' }, { milli: 1000n, unit: 'kg' }),
        },
      ])
      expect(
        hint(cheese, null, {
          typed: unitPrice({ minor: 160n, currency: 'USD' }, { milli: 200n, unit: 'kg' }),
          typedQuantity: { milli: 200n, unit: 'kg' },
        }).item?.kind,
      ).toBe('cheaper')
      // Марианна at $1,09 against Анелик typed at $1,99 — named.
      const marianna = alternative(MARIANNA, '4.5', [litre(109, 'USD')])
      expect(
        hint(rated([], [marianna], '4.0'), null, typedIn(199, 1000, 'USD')).alternative?.itemId,
      ).toBe(MARIANNA)
    })

    it('without the quantity typed, half a per cent alone', () => {
      expect(hint(rated([weighed(851, 1234)]), null, { typed: paid(104, 150) }).item?.kind).toBe(
        'there',
      )
    })
  })

  it('says «здесь же» when the cheapest was the record’s own place (Р-3), whatever the case of its id', () => {
    const only = rated([place(CITY, 600)])
    expect(hint(only, 650, { here: CITY.toUpperCase() }).item).toMatchObject({
      kind: 'there',
      here: true,
    })
  })

  it('is not «здесь» for a record the server has not named a place for yet', () => {
    expect(hint(rated([place(CITY, 600)]), 650, { here: null }).item?.here).toBe(false)
  })

  it('compares only inside the currency and the unit chosen on the sheet', () => {
    const mixed = rated([place(ZOVUNI, 300, { currency: 'RUB' }), place(CITY, 900, { unit: 'kg' })])
    expect(hint(mixed, 620)).toEqual({ item: null, alternative: null })
    expect(hint(mixed, null, { unit: 'kg' }).item).toMatchObject({
      kind: 'best',
      place: { placeId: CITY },
    })
    expect(hint(mixed, 620, { unit: 'kg' }).item).toBeNull()
    expect(hint(mixed, null, { typed: per(800, 'kg') }).item).toMatchObject({ kind: 'cheaper' })
  })

  it('keeps the server’s order between two places at one price', () => {
    const tied = rated([place(ZOVUNI, 540), place(CITY, 540)])
    expect(hint(tied, null).item?.place.placeId).toBe(ZOVUNI)
  })

  it('says nothing at all without a purchase', () => {
    expect(hint(rated([]), 620)).toEqual({ item: null, alternative: null })
  })

  it('says nothing of «не брать нигде», whatever is typed (Т-3)', () => {
    expect(hint({ itemId: ITEM, level: 'never' }, 620)).toEqual({ item: null, alternative: null })
  })
})

describe('cheaperHint · another item of the same kind (В-3, В-7…В-9)', () => {
  const marianna = alternative(MARIANNA, '4.5', [place(ZOVUNI, 480, { day: '2026-09-28' })])

  it('names a cheaper one rated no worse', () => {
    expect(hint(rated([place(ZOVUNI, 540)], [marianna]), 620).alternative).toMatchObject({
      itemId: MARIANNA,
      rating: '4.5',
      place: { placeId: ZOVUNI, day: '2026-09-28' },
    })
  })

  it('takes one rated the same — by the printed tenth', () => {
    const same = alternative(MARIANNA, '4.0', [place(ZOVUNI, 480)])
    expect(hint(rated([], [same], '4.0'), 620).alternative?.itemId).toBe(MARIANNA)
  })

  it('does not take one rated a tenth lower', () => {
    const lower = alternative(MARIANNA, '3.9', [place(ZOVUNI, 480)])
    expect(hint(rated([], [lower], '4.0'), 620).alternative).toBeNull()
  })

  it('does not take one at the same price, within the noise, or dearer — there is no reason to change (Р-12)', () => {
    expect(hint(rated([], [marianna]), 480).alternative).toBeNull()
    expect(hint(rated([], [marianna]), 482).alternative).toBeNull()
    expect(hint(rated([], [marianna]), 470).alternative).toBeNull()
    expect(hint(rated([], [marianna]), 483).alternative?.itemId).toBe(MARIANNA)
  })

  it('names the best rated of those that qualify, the cheapest breaking a tie — «показываем Анелик»', () => {
    const anelik = alternative(ANELIK, '5.0', [place(CITY, 500)])
    expect(hint(rated([], [marianna, anelik]), 620).alternative?.itemId).toBe(ANELIK)

    const anelikSame = alternative(ANELIK, '4.5', [place(CITY, 500)])
    expect(hint(rated([], [anelikSame, marianna]), 620).alternative?.itemId).toBe(MARIANNA)
  })

  it('compares with the item’s own cheapest place before a price is typed', () => {
    expect(hint(rated([place(ZOVUNI, 540)], [marianna]), null).alternative?.itemId).toBe(MARIANNA)
    expect(hint(rated([place(ZOVUNI, 470)], [marianna]), null).alternative).toBeNull()
  })

  it('names none with nothing to compare with — no price typed and never bought', () => {
    expect(hint(rated([], [marianna]), null).alternative).toBeNull()
  })

  it('compares only inside the sheet’s currency and unit', () => {
    const inRoubles = alternative(MARIANNA, '5.0', [place(ZOVUNI, 100, { currency: 'RUB' })])
    expect(hint(rated([], [inRoubles]), 620).alternative).toBeNull()
  })

  it('for an item not rated, takes only one in «Брать» (В-8)', () => {
    const unrated = (alternatives: OwnAlternative[]): OwnPrices => ({
      itemId: ITEM,
      level: 'unrated',
      places: [],
      alternatives,
    })
    expect(hint(unrated([marianna]), 620).alternative?.itemId).toBe(MARIANNA)
    const ifCheap = alternative(MARIANNA, '3.5', [place(ZOVUNI, 480)])
    expect(hint(unrated([ifCheap]), 620).alternative).toBeNull()
  })

  it('takes an «only if cheap» one beside an item rated as low', () => {
    const ifCheap = alternative(MARIANNA, '3.0', [place(ZOVUNI, 480)])
    const item: OwnPrices = {
      itemId: ITEM,
      level: 'if_cheap',
      rating: '3.0',
      places: [],
      alternatives: [ifCheap],
    }
    expect(hint(item, 620).alternative?.itemId).toBe(MARIANNA)
  })
})
