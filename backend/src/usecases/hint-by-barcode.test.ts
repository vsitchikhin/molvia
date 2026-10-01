import { describe, expect, it } from 'vitest'
import type { CachedAnswer, OpenFoodFactsRepository } from '@/db/open-food-facts-repository'
import type { OpenFoodFacts } from '@/open-food-facts/client'
import type { OffAnswer } from '@/open-food-facts/product'
import { FOUND_FRESH_DAYS, MISSED_FRESH_DAYS, hintByBarcode } from './hint-by-barcode'

const NUTELLA = '3017620422003'

const nutella: OffAnswer = {
  found: true,
  product: { names: { ru: 'Нутелла', en: 'Nutella' }, quantity: { milli: 400n, unit: 'kg' } },
}

const nutellaHint = {
  name: 'Нутелла',
  quantity: { milli: 400n, unit: 'kg' },
  url: `https://world.openfoodfacts.org/product/${NUTELLA}`,
}

function world(
  kept: Record<string, CachedAnswer> = {},
  answers: Record<string, OffAnswer | null> = {},
) {
  const asked: string[] = []
  const put: [string, OffAnswer][] = []
  const cache: OpenFoodFactsRepository = {
    get: (code) => Promise.resolve(kept[code] ?? null),
    put: (code, answer) => {
      put.push([code, answer])
      return Promise.resolve()
    },
    named: () => Promise.reject(new Error('named was not expected')),
  }
  const off: OpenFoodFacts = {
    product: (code) => {
      asked.push(code)
      return Promise.resolve(code in answers ? (answers[code] ?? null) : { found: false })
    },
  }
  return { cache, off, asked, put }
}

describe('hintByBarcode', () => {
  it('asks the base about a code nobody kept, keeps the answer and hints in the language asked', async () => {
    const { cache, off, asked, put } = world({}, { [NUTELLA]: nutella })

    expect(await hintByBarcode({ cache, off }, NUTELLA, 'ru')).toEqual(nutellaHint)
    expect(asked).toEqual([NUTELLA])
    expect(put).toEqual([[NUTELLA, nutella]])
  })

  it('names the product in English for an English interface', async () => {
    const { cache, off } = world({}, { [NUTELLA]: nutella })
    expect((await hintByBarcode({ cache, off }, NUTELLA, 'en'))?.name).toBe('Nutella')
  })

  it('keeps a miss too, and answers it with no hint', async () => {
    const { cache, off, put } = world()
    expect(await hintByBarcode({ cache, off }, '4850001270126', 'ru')).toBeNull()
    expect(put).toEqual([['4850001270126', { found: false }]])
  })

  it('asks in the form the code is written in: twelve digits as thirteen', async () => {
    const { cache, off, asked } = world()
    await hintByBarcode({ cache, off }, '012345678905', 'ru')
    expect(asked).toEqual(['0012345678905'])
  })

  it.each([
    ['a shop’s own label', '2000000000008'],
    ['a code whose check digit fails', '3017620422004'],
    ['no barcode’s shape', '123'],
    ['a GTIN-14 of a case', '13017620422000'],
  ])('never asks about %s', async (_case, code) => {
    const { cache, off, asked, put } = world()
    expect(await hintByBarcode({ cache, off }, code, 'ru')).toBeNull()
    expect(asked).toEqual([])
    expect(put).toEqual([])
  })

  it('asks nothing and answers nothing when the hint is off', async () => {
    const { cache } = world({ [NUTELLA]: { answer: nutella, ageDays: 0 } })
    expect(await hintByBarcode({ cache, off: null }, NUTELLA, 'ru')).toBeNull()
  })

  it(`believes a find for ${String(FOUND_FRESH_DAYS)} days without asking`, async () => {
    const { cache, off, asked } = world({
      [NUTELLA]: { answer: nutella, ageDays: FOUND_FRESH_DAYS - 1 },
    })
    expect(await hintByBarcode({ cache, off }, NUTELLA, 'ru')).toEqual(nutellaHint)
    expect(asked).toEqual([])
  })

  it(`believes a miss for ${String(MISSED_FRESH_DAYS)} days, then asks again`, async () => {
    const fresh = world({ [NUTELLA]: { answer: { found: false }, ageDays: MISSED_FRESH_DAYS - 1 } })
    expect(await hintByBarcode(fresh, NUTELLA, 'ru')).toBeNull()
    expect(fresh.asked).toEqual([])

    const stale = world(
      { [NUTELLA]: { answer: { found: false }, ageDays: MISSED_FRESH_DAYS } },
      { [NUTELLA]: nutella },
    )
    expect(await hintByBarcode(stale, NUTELLA, 'ru')).toEqual(nutellaHint)
    expect(stale.put).toEqual([[NUTELLA, nutella]])
  })

  it('asks again about a find past its days, and a base that cannot answer leaves the old find', async () => {
    const { cache, off, asked, put } = world(
      { [NUTELLA]: { answer: nutella, ageDays: FOUND_FRESH_DAYS } },
      { [NUTELLA]: null },
    )
    expect(await hintByBarcode({ cache, off }, NUTELLA, 'ru')).toEqual(nutellaHint)
    expect(asked).toEqual([NUTELLA])
    expect(put).toEqual([])
  })

  it('a base that cannot answer about a code nobody kept — no hint, nothing kept', async () => {
    const { cache, off, put } = world({}, { [NUTELLA]: null })
    expect(await hintByBarcode({ cache, off }, NUTELLA, 'ru')).toBeNull()
    expect(put).toEqual([])
  })
})
