import { afterAll, describe, expect, it } from 'vitest'
import { connect } from './db'

const sql = connect()

afterAll(async () => {
  await sql.end()
})

describe('the migrated database', () => {
  it('has the extensions catalogue search is built on', async () => {
    const rows = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('pg_trgm', 'unaccent')
    `
    expect(rows.map((row) => row.extname).sort()).toEqual(['pg_trgm', 'unaccent'])
  })

  it('scores a typo by trigram similarity', async () => {
    const [row] = await sql<{ close: number; far: number }[]>`
      select similarity('молоко', 'молокo') as close, similarity('молоко', 'хлеб') as far
    `
    expect(row?.close ?? 0).toBeGreaterThan(row?.far ?? 1)
  })

  it('does not transliterate Cyrillic — the reason search is still an open question', async () => {
    // unaccent strips diacritics, nothing more. Pinned here so the limitation is a fact
    // the suite states rather than something rediscovered when search is built:
    // "malako" cannot reach "молоко" through unaccent alone.
    const [row] = await sql<{ cyrillic: string; latin: string }[]>`
      select unaccent('Ереван') as cyrillic, unaccent('café') as latin
    `
    expect(row?.cyrillic).toBe('Ереван')
    expect(row?.latin).toBe('cafe')
  })
})
