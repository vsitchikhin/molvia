import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { toSearchKey } from '@molvia/model'
import { rekeyItems } from '@/db/rekey'
import { items } from '@/db/schema'
import { connectDrizzle } from './db'
import { clearAll, insertItem } from './fixtures'

const { db, close } = connectDrizzle()

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

// Sorted here: the database's collation would put «Č» and the scripts in an order of its own.
const keys = async () =>
  (await db.select({ name: items.name, key: items.searchKey }).from(items)).sort((a, b) =>
    a.key.localeCompare(b.key, 'en'),
  )

// The keys the tables before MOL-109 gave: a háček stripped, Georgian and ђ left as they were.
describe('пересчёт ключей при старте (MOL-109, В-2)', () => {
  it('переписывает ключ, разошедшийся с нынешними таблицами, и только его', async () => {
    await insertItem(db, { name: 'Čokolada', searchKey: 'kokolada' })
    await insertItem(db, { name: 'ხაჭაპური', searchKey: 'ხაჭაპური' })
    await insertItem(db, { name: 'Ђумбир', searchKey: 'ђumbir' })
    await insertItem(db, { name: 'Молоко', searchKey: 'moloko' })

    expect(await rekeyItems(db)).toBe(3)
    expect(await keys()).toEqual([
      { name: 'Čokolada', key: 'chokolada' },
      { name: 'Ђумбир', key: 'djumbir' },
      { name: 'ხაჭაპური', key: 'hachapuri' },
      { name: 'Молоко', key: 'moloko' },
    ])
    for (const row of await keys()) expect(row.key).toBe(toSearchKey(row.name))
  })

  it('второй старт не пишет ничего', async () => {
    await insertItem(db, { name: 'Šunka', searchKey: 'sunka' })
    expect(await rekeyItems(db)).toBe(1)
    expect(await rekeyItems(db)).toBe(0)
    expect(await keys()).toEqual([{ name: 'Šunka', key: 'shunka' }])
  })

  it('без позиций — ноль, без ошибки', async () => {
    expect(await rekeyItems(db)).toBe(0)
  })
})
