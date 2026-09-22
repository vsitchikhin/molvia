import { describe, expect, it } from 'vitest'
import type { AdvicePlace } from '@molvia/model'
import { placesView } from '@/components/adviceRow'

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

  it('one place is «Брали здесь»: a superlative out of one observation is a conclusion from nothing', () => {
    expect(placesView([market])).toEqual({ kind: 'sole', best: market, rest: [] })
  })

  it('two and more is «Дешевле всего», and the rest go into «Ещё»', () => {
    expect(placesView([market, sas, carrefour])).toEqual({
      kind: 'cheapest',
      best: market,
      rest: [sas, carrefour],
    })
  })

  it('the order is the answer`s and is never rearranged', () => {
    // The server sorts by unit price with the asker's own city first (MOL-31, Р-26); the city
    // is not in the row at all, so a screen that sorted again would undo that rule blindly.
    expect(placesView([sas, market]).kind).toBe('cheapest')
    expect(placesView([sas, market])).toMatchObject({ best: sas, rest: [market] })
  })
})
