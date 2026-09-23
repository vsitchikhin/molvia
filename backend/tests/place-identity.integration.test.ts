import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { placeNameIdentity } from '@molvia/model'
import { placeIdentity } from '@/db/schema'
import { connectDrizzle } from './db'

const { db, close } = connectDrizzle()
afterAll(close)

/**
 * The database decides when two spellings are one place; `placeNameIdentity` is its twin in
 * TypeScript, for the screen that has to know the same thing before any request is made
 * (MOL-25, В3). A copy that drifts from its twin is the bug it exists to prevent — the same
 * thing that happened twice to `INVISIBLE` and once to what a secret may look like — so the two
 * are held equal here rather than by memory.
 */
const CORPUS = [
  'Ереван Сити',
  'ереван сити',
  'ЕРЕВАН СИТИ',
  ' Ереван Сити ',
  ' Ереван Сити​',
  '﻿Ереван Сити',
  // Two spaces inside stay two: `btrim` touches the ends only, so the server keeps them apart.
  'Ереван  Сити',
  'SAS',
  'sas',
  'ＳＡＳ',
  'Кафе ☕',
  'Кафе ☕️',
  'Кафе ☕︎',
  'Գյումրի',
  'Գյումրի ',
  'Café',
  'Café',
  'ﬁnе',
  '½ кг',
  'Ⅻ',
  'Магазин №1',
  '  ',
  '',
  'x'.repeat(120),
]

it('answers exactly what the unique index over places computes', async () => {
  const rows = await db.execute<{ name: string; identity: string }>(
    sql`select value as name, ${placeIdentity(sql`value`)} as identity
        from unnest(array[${sql.join(
          CORPUS.map((name) => sql`${name}`),
          sql`, `,
        )}]::text[]) as value`,
  )
  expect(rows.length).toBe(CORPUS.length)
  for (const row of rows) {
    expect({ name: row.name, identity: placeNameIdentity(row.name) }).toEqual({
      name: row.name,
      identity: row.identity,
    })
  }
})
