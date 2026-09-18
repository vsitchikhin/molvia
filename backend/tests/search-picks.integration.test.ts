import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DomainError } from '@molvia/model'
import { randomUUID } from 'node:crypto'
import { createSearchPickRepository } from '@/db/search-picks-repository'
import { searchPicks } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem } from './fixtures'

const { db, close } = connectDrizzle()
const picks = createSearchPickRepository(db)

async function rows() {
  return db.select().from(searchPicks)
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('запоминание пары «запрос → позиция»', () => {
  it('первая пара — одна строка со счётчиком 1, под ключом запроса', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await picks.remember(actorId, 'Молоко', itemId)

    expect(await rows()).toMatchObject([{ actorId, itemId, queryKey: 'moloko', picks: 1 }])
  })

  it('та же пара второй раз — та же строка, счётчик 2, время сдвинулось', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await picks.remember(actorId, 'молоко', itemId)
    const [first] = await rows()
    await picks.remember(actorId, 'молоко', itemId)
    const after = await rows()

    expect(after).toHaveLength(1)
    expect(after[0]?.picks).toBe(2)
    expect(after[0]?.lastPickedAt.getTime()).toBeGreaterThan(first?.lastPickedAt.getTime() ?? 0)
  })

  it('тот же запрос в другой письменности — та же строка, не вторая', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await picks.remember(actorId, 'молоко', itemId)
    await picks.remember(actorId, 'moloko', itemId)
    await picks.remember(actorId, 'Մոլոկո', itemId)

    expect(await rows()).toMatchObject([{ queryKey: 'moloko', picks: 3 }])
  })

  it.each(['', '   ', '!!!', '«»'])(
    'запрос без букв и цифр («%s») не запоминается и не падает',
    async (query) => {
      const actorId = await insertActor(db)
      const itemId = await insertItem(db)

      await picks.remember(actorId, query, itemId)

      expect(await rows()).toHaveLength(0)
    },
  )

  it('ключ ровно в 600 октетов запоминается, в 601 — молча нет', async () => {
    // `ab` has no doubled letter to collapse and no c to harden, so the key is the query.
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await picks.remember(actorId, 'ab'.repeat(300), itemId)
    await picks.remember(actorId, `${'ab'.repeat(300)}a`, itemId)

    expect((await rows()).map((row) => row.queryKey.length)).toEqual([600])
  })

  it('считает октеты, а не символы: грузинский ключ упирается раньше', async () => {
    // A letter the tables do not know keeps itself. Georgian is three octets in UTF-8, so
    // 301 characters are 903 octets — well inside `varchar(600)`, past the CHECK.
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await expect(picks.remember(actorId, 'აბ'.repeat(150) + 'ა', itemId)).resolves.toBeUndefined()

    expect(await rows()).toHaveLength(0)
  })

  it('запрос из тринадцати слов запоминается первыми двенадцатью — как его ищет поиск', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)
    const words = Array.from({ length: 13 }, (_, n) => `slovo${String(n)}`)

    await picks.remember(actorId, words.join(' '), itemId)

    expect((await rows())[0]?.queryKey).toBe(words.slice(0, 12).join(' '))
  })

  it('несуществующая позиция — отказ внешнего ключа, как у остальных репозиториев', async () => {
    const actorId = await insertActor(db)

    await expect(picks.remember(actorId, 'молоко', randomUUID())).rejects.toThrow(DomainError)
  })

  it('пишет в транзакцию вызывающего: откат — и пары нет', async () => {
    const actorId = await insertActor(db)
    const itemId = await insertItem(db)

    await expect(
      db.transaction(async (tx) => {
        await createSearchPickRepository(tx).remember(actorId, 'молоко', itemId)
        throw new Error('the expense failed')
      }),
    ).rejects.toThrow('the expense failed')

    expect(await rows()).toHaveLength(0)
  })

  it('двое с одним запросом и одной позицией — две строки, у каждого своя', async () => {
    const one = await insertActor(db)
    const other = await insertActor(db)
    const itemId = await insertItem(db)

    await picks.remember(one, 'молоко', itemId)
    await picks.remember(other, 'молоко', itemId)

    expect(await rows()).toHaveLength(2)
  })
})
