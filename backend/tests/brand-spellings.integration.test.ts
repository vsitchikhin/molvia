import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createBrandSpellingRepository } from '@/db/brand-spellings-repository'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

/** What the model said of a brand's package (MOL-326, owner's В-1 «б»): said once, the first word standing. */
const { db, close } = connectDrizzle()
const spellings = createBrandSpellingRepository(db)

beforeEach(async () => {
  await clearAll(db)
})
afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('brand_spellings (MOL-326)', () => {
  it('says what was said of the brands asked, none where none was taken, nothing of one never asked', async () => {
    await spellings.remember(
      [
        { brand: 'ֆելիքս', spelling: 'Felix' },
        { brand: 'աշտարակ կաթ', spelling: null },
      ],
      'claude-haiku-5-5@brands-v1',
    )
    expect(await spellings.said(['ֆելիքս', 'աշտարակ կաթ', 'ֆերրերո'])).toEqual(
      new Map([
        ['ֆելիքս', 'Felix'],
        ['աշտարակ կաթ', null],
      ]),
    )
    expect(await spellings.spelt()).toEqual(new Map([['ֆելիքս', 'Felix']]))
    expect(await spellings.said([])).toEqual(new Map())
  })

  it('keeps the first word of a brand said twice: two receipts read at once', async () => {
    await spellings.remember([{ brand: 'ֆելիքս', spelling: 'Felix' }], 'v1')
    await spellings.remember([{ brand: 'ֆելիքս', spelling: null }], 'v2')
    expect(await spellings.said(['ֆելիքս'])).toEqual(new Map([['ֆելիքս', 'Felix']]))
  })

  it('refuses a brand of no Armenian letter and a spelling past a name’s length', async () => {
    await expect(
      spellings.remember([{ brand: 'felix', spelling: 'Felix' }], 'v1'),
    ).rejects.toThrow()
    await expect(
      spellings.remember([{ brand: 'ֆելիքս', spelling: 'x'.repeat(41) }], 'v1'),
    ).rejects.toThrow()
  })
})
