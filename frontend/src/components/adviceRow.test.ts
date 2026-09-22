import { describe, expect, it } from 'vitest'
import type { AdvicePlace } from '@molvia/model'
import { ownScore, placesView, whereKey } from '@/components/adviceRow'

function place(name: string, amount: bigint): AdvicePlace {
  return {
    placeId: `aaaaaaaa-0000-4000-8000-${name.length.toString().padStart(12, '0')}`,
    name,
    unitPrice: { scaledMinor: amount, currency: 'AMD', unit: 'kg' },
    observations: 1,
  }
}

const market = place('Рынок в Гюмри', 4_790_000_000n)
const sas = place('SAS', 5_100_000_000n)
const carrefour = place('Carrefour', 5_240_000_000n)

describe('placesView', () => {
  it('no place at all — rated but never bought, so there is no price block', () => {
    expect(placesView([])).toEqual({ kind: 'none' })
  })

  it('one place is no comparison: nothing to be cheapest among', () => {
    expect(placesView([market])).toEqual({
      kind: 'places',
      best: market,
      rest: [],
      cheapest: false,
    })
  })

  it('the named place is the cheapest when it really is, and the rest go into «Ещё»', () => {
    expect(placesView([market, sas, carrefour])).toEqual({
      kind: 'places',
      best: market,
      rest: [sas, carrefour],
      cheapest: true,
    })
  })

  it('the order is the answer`s and is never rearranged', () => {
    // The server sorts own city first, then by price (MOL-31, Р-26); the city is not in the
    // row at all, so a screen that sorted again would undo that rule blindly.
    expect(placesView([sas, market])).toMatchObject({ best: sas, rest: [market] })
  })

  it('А1: the first place is not always the cheapest, and then it is not called so', () => {
    // Own city first means a dearer place at home stands above a cheaper one a city away.
    const view = placesView([sas, market])

    expect(view).toMatchObject({ cheapest: false })
    expect(whereKey(view)).toBe('advice.bought_at')
    expect(whereKey(placesView([market, sas]))).toBe('advice.cheapest_at')
    expect(whereKey(placesView([market]))).toBe('advice.bought_at')
    expect(whereKey(placesView([]))).toBe('advice.bought_at')
  })

  it('prices of two currencies are no comparison either, so the word goes', () => {
    const inRubles = { ...sas, unitPrice: { ...sas.unitPrice, currency: 'RUB' as const } }

    expect(placesView([market, inRubles])).toMatchObject({ cheapest: false })
  })
})

describe('ownScore', () => {
  it('in the own mode the figure on the row is this person`s score', () => {
    expect(ownScore('4.0', 'own')).toBe(4)
    expect(ownScore('1.0', 'own')).toBe(1)
  })

  it('in the shared mode nothing is offered: an average is nobody`s opinion', () => {
    // Pre-chosen, a save would write four other people's average down as this person's score.
    expect(ownScore('4.0', 'shared')).toBeNull()
    expect(ownScore('4.3', 'shared')).toBeNull()
  })

  it('a fraction means the row is not one person`s, whatever the mode says', () => {
    expect(ownScore('4.3', 'own')).toBeNull()
  })
})
