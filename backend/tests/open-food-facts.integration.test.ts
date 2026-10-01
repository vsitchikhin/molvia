/**
 * The cache of Open Food Facts' answers (MOL-162) and the mark of an item proposed with a code the
 * base named, against the real schema: the CHECKs that keep a row whole, the age by the database's
 * calendar, the overwrite.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createOpenFoodFactsRepository } from '@/db/open-food-facts-repository'
import { items, openFoodFacts } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll } from './fixtures'

const { db, close } = connectDrizzle()
const cache = createOpenFoodFactsRepository(db)

const NUTELLA = '3017620422003'
const found = {
  found: true,
  product: { names: { ru: 'Nutella', en: 'Nutella' }, quantity: { milli: 400n, unit: 'kg' } },
} as const

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await close()
})

describe('кеш ответов Open Food Facts', () => {
  it('находка и промах читаются, как были записаны, возраст — ноль дней', async () => {
    await cache.put(NUTELLA, found)
    await cache.put('4850001270129', { found: false })

    expect(await cache.get(NUTELLA)).toEqual({ answer: found, ageDays: 0 })
    expect(await cache.get('4850001270129')).toEqual({ answer: { found: false }, ageDays: 0 })
    expect(await cache.get('4600000000003')).toBeNull()
  })

  it('находка без объёма — объём null', async () => {
    const noSize = { found: true, product: { names: { ru: 'Сыр', en: 'Cheese' }, quantity: null } }
    await cache.put(NUTELLA, noSize)
    expect((await cache.get(NUTELLA))?.answer).toEqual(noSize)
  })

  it('возраст — по календарю базы', async () => {
    await cache.put(NUTELLA, found)
    await db
      .update(openFoodFacts)
      .set({ fetchedOn: sql`current_date - 31` })
      .where(eq(openFoodFacts.code, NUTELLA))
    expect((await cache.get(NUTELLA))?.ageDays).toBe(31)
  })

  it('новый ответ перезаписывает старый и его день: промах, ставший находкой', async () => {
    await cache.put(NUTELLA, { found: false })
    await db
      .update(openFoodFacts)
      .set({ fetchedOn: sql`current_date - 8` })
      .where(eq(openFoodFacts.code, NUTELLA))

    await cache.put(NUTELLA, found)

    expect(await cache.get(NUTELLA)).toEqual({ answer: found, ageDays: 0 })
    expect(await db.select().from(openFoodFacts)).toHaveLength(1)
  })

  it('находка, ставшая промахом, теряет имена и объём', async () => {
    await cache.put(NUTELLA, found)
    await cache.put(NUTELLA, { found: false })
    const [row] = await db.select().from(openFoodFacts)
    expect(row).toMatchObject({ found: false, nameRu: null, nameEn: null, quantityMilli: null })
  })

  it('named: находка среди кодов — да; промах, незнакомый и пустой список — нет', async () => {
    await cache.put(NUTELLA, found)
    await cache.put('4850001270129', { found: false })

    expect(await cache.named(['4600000000003', NUTELLA])).toBe(true)
    expect(await cache.named(['4850001270129'])).toBe(false)
    expect(await cache.named(['4600000000003'])).toBe(false)
    expect(await cache.named([])).toBe(false)
  })

  it('named: старая находка тоже — что было показано, то показано', async () => {
    await cache.put(NUTELLA, found)
    await db.update(openFoodFacts).set({ fetchedOn: sql`current_date - 400` })
    expect(await cache.named([NUTELLA])).toBe(true)
  })
})

describe('база держит строку целой', () => {
  async function refused(values: Record<string, unknown>): Promise<string> {
    try {
      await db.insert(openFoodFacts).values({ code: NUTELLA, found: true, ...values })
    } catch (error) {
      return String((error as { cause?: { constraint_name?: string } }).cause?.constraint_name)
    }
    return 'accepted'
  }

  it.each([
    ['находка без имени', { nameRu: null, nameEn: 'x' }, 'open_food_facts_names_found'],
    ['находка с одним именем', { nameRu: 'x', nameEn: null }, 'open_food_facts_names_found'],
    ['промах с именем', { found: false, nameRu: 'x', nameEn: 'x' }, 'open_food_facts_names_found'],
    [
      'объём без единицы',
      { nameRu: 'x', nameEn: 'x', quantityMilli: 1n },
      'open_food_facts_quantity_paired',
    ],
    [
      'объём у промаха',
      { found: false, quantityMilli: 1n, quantityUnit: 'kg' },
      'open_food_facts_quantity_found',
    ],
    [
      'объём ноль',
      { nameRu: 'x', nameEn: 'x', quantityMilli: 0n, quantityUnit: 'kg' },
      'open_food_facts_quantity_positive',
    ],
    [
      'объём в штуках',
      { nameRu: 'x', nameEn: 'x', quantityMilli: 1000n, quantityUnit: 'piece' },
      'open_food_facts_quantity_unit',
    ],
    ['код не той формы', { code: '123', nameRu: 'x', nameEn: 'x' }, 'open_food_facts_gtin_shape'],
  ])('%s — отказ', async (_case, values, constraint) => {
    expect(await refused(values)).toBe(constraint)
  })
})

describe('пометка происхождения позиции', () => {
  it('ничего, кроме open_food_facts и null, база не примет', async () => {
    const base = {
      kind: 'product' as const,
      name: 'Nutella',
      searchKey: 'nutela',
      defaultUnit: 'kg' as const,
    }
    await db.insert(items).values({ id: crypto.randomUUID(), ...base, origin: 'open_food_facts' })
    await db.insert(items).values({ id: crypto.randomUUID(), ...base, origin: null })
    await expect(
      db.insert(items).values({ id: crypto.randomUUID(), ...base, origin: 'gs1' as never }),
    ).rejects.toMatchObject({ cause: { constraint_name: 'items_origin_known' } })
  })
})
