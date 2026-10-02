import { afterAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { connectDrizzle } from './db'

const { db, close } = connectDrizzle()
afterAll(close)

/**
 * The database image is part of the contract (MOL-105, `deploy/README.md`). Without these, an image
 * missing any of it is found by a failed query or a failed boot, never by a test.
 */

it('carries pgvector, with the HNSW index the embeddings need', async () => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`create temporary table probe (embedding halfvec(3)) on commit drop`)
    await tx.execute(sql`create index on probe using hnsw (embedding halfvec_cosine_ops)`)
    await tx.execute(sql`insert into probe values ('[1,0,0]'), ('[0,1,0]')`)
    const rows = await tx.execute<{ embedding: string }>(
      sql`select embedding::text from probe order by embedding <=> '[1,0.1,0]' limit 1`,
    )
    expect(rows.map((row) => row.embedding)).toEqual(['[1,0,0]'])
  })
})

it('sorts by ICU, as «Что брать» does (MOL-31)', async () => {
  const rows = await db.execute<{ name: string }>(
    sql`select name from unnest(array['Ежевика', 'ёжик', 'Ёжик', 'ежевика']) as name
        order by name collate "und-x-icu", name`,
  )
  expect(rows.map((row) => row.name)).toEqual(['ежевика', 'Ежевика', 'ёжик', 'Ёжик'])
})

/**
 * A collation whose recorded version is not the library's warns on every query that uses it and
 * may order otherwise than its indexes were built: a database carried over to another image
 * without the rebuild of `0038_pgvector`. On CI's fresh database these hold by construction; they
 * catch a working copy's volume carried over, and a tag moved without its migration.
 */
it('has no collation built by another version of ICU', async () => {
  const rows = await db.execute<{ name: string }>(
    sql`select collname as name from pg_collation
        where collprovider = 'i' and collversion is distinct from pg_collation_actual_version(oid)`,
  )
  expect(rows.map((row) => row.name)).toEqual([])
})

it('has its own collation of the libc it runs on, where a version was recorded', async () => {
  const [row] = await db.execute<{ recorded: string | null; actual: string | null }>(
    sql`select datcollversion as recorded,
               pg_database_collation_actual_version(oid) as actual
        from pg_database where datname = current_database()`,
  )
  // A volume moved off alpine records none (`deploy/README.md`): nothing to compare there.
  expect(row?.recorded ?? row?.actual).toBe(row?.actual)
})
