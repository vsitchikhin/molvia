import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import {
  ADVICE_WARNINGS_RESERVED,
  AGGREGATE_MIN_CONTRIBUTIONS,
  NEVER_BELOW_TENTHS,
} from '@molvia/model'
import type { AdviceScope } from '@molvia/model'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, insertPlace } from './fixtures'
import { createVerdictRepository } from '@/db/verdicts-repository'
import { verdicts as verdictsTable } from '@/db/schema'

const { db, close } = connectDrizzle()
const verdicts = createVerdictRepository(db)

/** The query «Что брать» makes, with the domain's numbers — written once, so a new one
 * cannot be forgotten in half the callers. */
function query(actorId: string, scope: AdviceScope, limit: number) {
  return {
    actorId,
    scope,
    minContributions: AGGREGATE_MIN_CONTRIBUTIONS,
    neverBelowTenths: NEVER_BELOW_TENTHS,
    warningsReserved: ADVICE_WARNINGS_RESERVED,
    limit,
  }
}

async function rowsFor(actorId: string, scope: AdviceScope = 'own', limit = 50) {
  const { rows } = await verdicts.adviceRowsFor(query(actorId, scope, limit))
  return rows
}

/** The counter travels with the page, so the two can be read apart. */
function totalFor(actorId: string, scope: AdviceScope = 'own', limit = 50) {
  return verdicts.adviceRowsFor(query(actorId, scope, limit)).then((answer) => answer.total)
}

/** Rates without going through the repository: the read is what these tests are about. */
async function rate(
  actorId: string,
  itemId: string,
  score: number,
  review: string | null = null,
): Promise<void> {
  await db
    .insert(verdictsTable)
    .values({ id: crypto.randomUUID(), actorId, itemId, itemKind: 'product', score, review })
}

async function withdraw(actorId: string, itemId: string): Promise<void> {
  await db
    .update(verdictsTable)
    .set({ deletedAt: sql`clock_timestamp()`, review: null })
    .where(and(eq(verdictsTable.actorId, actorId), eq(verdictsTable.itemId, itemId)))
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('свои данные', () => {
  it('отдают собственную оценку как пару «сумма из одной»', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db, { name: 'Говядина, вырезка' })
    await rate(actorId, itemId, 5, 'Лучшее мясо в городе')

    expect(await rowsFor(actorId)).toEqual([
      { itemId, name: 'Говядина, вырезка', sum: 5, count: 1, review: 'Лучшее мясо в городе' },
    ])
  })

  it('не видят чужую оценку, сколько бы её ни было', async () => {
    const me = await insertActor(db)
    const item = await insertItem(db)
    for (let n = 0; n < 5; n += 1) await rate(await insertActor(db), item, 5)

    expect(await rowsFor(me)).toEqual([])
  })

  it('не видят снятую — она остаётся строкой только для ворот', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(actorId, itemId, 4)
    await withdraw(actorId, itemId)

    expect(await rowsFor(actorId)).toEqual([])
  })

  it('не приводят блюдо: его оценивают там, где подали, а до 0.3 такого пути нет', async () => {
    const actorId = await insertActor(db)
    const placeId = await insertPlace(db, { kind: 'venue', name: 'Кафе «Понтэ»' })
    const dish = await insertItem(db, { kind: 'dish', name: 'Карбонара' })
    await db.insert(verdictsTable).values({
      id: crypto.randomUUID(),
      actorId,
      itemId: dish,
      itemKind: 'dish',
      placeId,
      score: 5,
    })

    expect(await rowsFor(actorId)).toEqual([])
  })
})

describe('общие данные', () => {
  it('усредняют с трёх вкладчиков', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)
    await rate(await insertActor(db), itemId, 4)
    await rate(await insertActor(db), itemId, 4)

    expect(await rowsFor(me, 'shared')).toMatchObject([{ itemId, sum: 13, count: 3 }])
  })

  it('на двоих отдают мои цифры, а не среднюю: из неё вычитается чужая оценка', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)
    await rate(await insertActor(db), itemId, 4)

    expect(await rowsFor(me, 'shared')).toMatchObject([{ itemId, sum: 5, count: 1 }])
  })

  it('не приводят чужую позицию, пока вкладчиков меньше трёх', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(await insertActor(db), itemId, 1)
    await rate(await insertActor(db), itemId, 2)

    expect(await rowsFor(me, 'shared')).toEqual([])
  })

  it('приводят чужую позицию, как только вкладчиков ровно три', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db, { name: 'Колбаса «Молочная»' })
    await rate(await insertActor(db), itemId, 1)
    await rate(await insertActor(db), itemId, 2)
    await rate(await insertActor(db), itemId, 2)

    expect(await rowsFor(me, 'shared')).toMatchObject([{ itemId, sum: 5, count: 3 }])
  })

  it('не считают снятую чужую оценку ни суммой, ни вкладом', async () => {
    const me = await insertActor(db)
    const gone = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(me, itemId, 5)
    await rate(await insertActor(db), itemId, 4)
    await rate(gone, itemId, 1)
    await withdraw(gone, itemId)

    // Трое было, двое осталось — значит, снова мои цифры.
    expect(await rowsFor(me, 'shared')).toMatchObject([{ itemId, sum: 5, count: 1 }])
  })

  it('отдают только мой отзыв: чужие слова нечем усреднить', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    await rate(me, itemId, 2, 'Пахнет крахмалом')
    await rate(await insertActor(db), itemId, 2, 'Дрянь')
    await rate(await insertActor(db), itemId, 3, 'Так себе')

    expect((await rowsFor(me, 'shared'))[0]?.review).toBe('Пахнет крахмалом')
  })

  it('отдают чужую позицию без отзыва, а не с чужим', async () => {
    const me = await insertActor(db)
    const itemId = await insertItem(db)
    for (const text of ['Дрянь', 'Так себе', 'Не брал бы']) {
      await rate(await insertActor(db), itemId, 2, text)
    }

    expect((await rowsFor(me, 'shared'))[0]?.review).toBeNull()
  })
})

describe('порядок и предел', () => {
  it('ставят выше то, что нравится больше, а при равной оценке — по названию', async () => {
    const actorId = await insertActor(db)
    const beef = await insertItem(db, { name: 'Говядина' })
    const cheese = await insertItem(db, { name: 'Сыр «Чанах»' })
    const apples = await insertItem(db, { name: 'Яблоки' })
    await rate(actorId, beef, 4)
    await rate(actorId, cheese, 5)
    await rate(actorId, apples, 4)

    expect((await rowsFor(actorId)).map((row) => row.name)).toEqual([
      'Сыр «Чанах»',
      'Говядина',
      'Яблоки',
    ])
  })

  it('сравнивают среднюю, а не сумму: 4,5 вдвоём ниже пятёрки одного', async () => {
    const me = await insertActor(db)
    const shared = await insertItem(db, { name: 'Общая' })
    const mine = await insertItem(db, { name: 'Моя' })
    await rate(me, mine, 5)
    await rate(me, shared, 5)
    await rate(await insertActor(db), shared, 4)
    await rate(await insertActor(db), shared, 4)

    // 13/3 = 4,33 против 5,0 — сумма у общей больше, средняя меньше.
    expect((await rowsFor(me, 'shared')).map((row) => row.name)).toEqual(['Моя', 'Общая'])
  })

  it('соблюдают предел и не падают на странном числе', async () => {
    const actorId = await insertActor(db)
    for (const name of ['Один', 'Два', 'Три'])
      await rate(actorId, await insertItem(db, { name }), 4)

    expect(await rowsFor(actorId, 'own', 2)).toHaveLength(2)
    expect(await rowsFor(actorId, 'own', 0)).toHaveLength(0)
    expect(await rowsFor(actorId, 'own', -1)).toHaveLength(0)
    expect(await rowsFor(actorId, 'own', 2.5)).toHaveLength(2)
  })

  it('отвечают пустым списком на личность, которой не бывает', async () => {
    expect(await rowsFor('не-uuid')).toEqual([])
  })

  it('держат места для чужих предупреждений, когда своих строк хватает на всю страницу', async () => {
    // Своё стояло выше предупреждения, и чужое «не брать нигде» вылетало первым — то есть
    // ровно то, ради чего человек открывал доступ (адверсариальный раунд 2, G2).
    const me = await insertActor(db)
    const crowd = [await insertActor(db), await insertActor(db), await insertActor(db)]
    const page = 10
    const reserved = 2

    for (let n = 0; n < page; n += 1) {
      await rate(me, await insertItem(db, { name: `Моё ${String(n).padStart(2, '0')}` }), 5)
    }
    for (let n = 0; n < 5; n += 1) {
      const itemId = await insertItem(db, { name: `Чужая отрава ${String(n).padStart(2, '0')}` })
      for (const who of crowd) await rate(who, itemId, 1)
    }

    const rows = await verdicts.adviceRowsFor({
      ...query(me, 'shared', page),
      warningsReserved: reserved,
    })

    expect(rows.total).toBe(page + 5)
    expect(rows.rows).toHaveLength(page)
    // Ровно столько чужих предупреждений, сколько мест для них отведено, — и ни одним больше.
    const strangers = rows.rows.filter((row) => row.count === crowd.length)
    expect(strangers).toHaveLength(reserved)
    expect(rows.rows.filter((row) => row.count === 1)).toHaveLength(page - reserved)
  })

  it('не занимают резерв, когда предупреждений меньше: место не простаивает', async () => {
    const me = await insertActor(db)
    const crowd = [await insertActor(db), await insertActor(db), await insertActor(db)]
    for (let n = 0; n < 10; n += 1) {
      await rate(me, await insertItem(db, { name: `Моё ${String(n).padStart(2, '0')}` }), 5)
    }
    const only = await insertItem(db, { name: 'Чужая отрава' })
    for (const who of crowd) await rate(who, only, 1)

    const rows = await verdicts.adviceRowsFor({ ...query(me, 'shared', 10), warningsReserved: 5 })

    expect(rows.rows.filter((row) => row.count === 3)).toHaveLength(1)
    expect(rows.rows.filter((row) => row.count === 1)).toHaveLength(9)
  })

  it('считают всё, что есть, а не только страницу', async () => {
    const actorId = await insertActor(db)
    for (const name of ['Один', 'Два', 'Три'])
      await rate(actorId, await insertItem(db, { name }), 4)

    expect(await totalFor(actorId, 'own', 2)).toBe(3)
    expect(await rowsFor(actorId, 'own', 2)).toHaveLength(2)
  })

  it('берегут от предела своё и «не брать нигде» (Р-23)', async () => {
    const me = await insertActor(db)
    const mine = await insertItem(db, { name: 'Моя тройка' })
    await rate(me, mine, 3)
    const bad = await insertItem(db, { name: 'Чужая единица' })
    for (let n = 0; n < 3; n += 1) await rate(await insertActor(db), bad, 1)
    // Две чужие пятёрки: по оценке они выше обеих, и предел в две строки съел бы и мою
    // тройку, и предупреждение.
    for (const name of ['Чужая пятёрка', 'Ещё пятёрка']) {
      const other = await insertItem(db, { name })
      for (let n = 0; n < 3; n += 1) await rate(await insertActor(db), other, 5)
    }

    const names = (await rowsFor(me, 'shared', 2)).map((row) => row.name)
    expect(names).toEqual(['Моя тройка', 'Чужая единица'])
    expect(await totalFor(me, 'shared', 2)).toBe(4)
  })
})
