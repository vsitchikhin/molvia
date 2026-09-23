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
  // Where the two folded differently on the first day (Д3, Г-1). The Greek pair is the
  // dangerous half: the database reads «ΑΣ» and «Ας» as two places, and a twin that merged
  // them would keep the screen quiet about prices moving into another shop.
  'ΟΔΟΣ',
  'ΑΣ',
  'Ας',
  'ασ',
  'İstanbul Market',
  'Istanbul Market',
  'ǄURA',
  'ǅura',
  'ẞUDAPEST',
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

/**
 * The named cases above are the ones already met; this is what keeps a third from hiding, over
 * the scripts a shop name in Gyumri or Yerevan is actually written in. Every character of them
 * goes through both, alone and inside a name, the way `text.ts` walks every code point.
 *
 * **Not the whole of Unicode, and the reason is named.** `lower()` folds by the tables of the
 * libc the database image was built with, and `toLowerCase` by the ones in this runtime; the
 * image is `postgres:17-alpine`, whose musl is older than V8's ICU, so letters added to Unicode
 * recently — `Ᲊ`, `Ⱟ`, `Ꟁ` — are folded here and left alone there. That is the unsafe direction:
 * the twin would merge what the database keeps apart, and the screen would then keep quiet about
 * prices moving into another shop. The residue is knowingly accepted — a shop named with a
 * medievalist's letter is not a case this product meets — and the price is a softer sentence on
 * one sheet, never a write. Widening this sweep means owning the database image.
 */
const SCRIPTS: readonly [number, number][] = [
  [0x20, 0x24f], // ASCII, Latin-1, Latin Extended-A and -B
  [0x370, 0x3ff], // Greek and Coptic — the final sigma lives here
  [0x400, 0x4ff], // Cyrillic
  [0x530, 0x58f], // Armenian
]

it('answers the same for every letter of the scripts a shop name is written in', async () => {
  const points: string[] = []
  for (const [first, last] of SCRIPTS) {
    for (let code = first; code <= last; code += 1) points.push(String.fromCodePoint(code))
  }
  const names = [...points, ...points.map((character) => `Кафе ${character}`)]
  const divergent: { name: string; postgres: string; typescript: string }[] = []
  for (let at = 0; at < names.length; at += 2000) {
    const batch = names.slice(at, at + 2000)
    const rows = await db.execute<{ name: string; identity: string }>(
      sql`select value as name, ${placeIdentity(sql`value`)} as identity
          from unnest(array[${sql.join(
            batch.map((name) => sql`${name}`),
            sql`, `,
          )}]::text[]) as value`,
    )
    for (const row of rows) {
      const mine = placeNameIdentity(row.name)
      if (mine !== row.identity) {
        divergent.push({ name: row.name, postgres: row.identity, typescript: mine })
      }
    }
  }
  expect(divergent.slice(0, 20)).toEqual([])
}, 60_000)
