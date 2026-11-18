import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { telegramId } from './fixtures'
import { MIGRATIONS } from '@/db/migrate'
import { onlyRow } from './rows'

/**
 * 0089 on a database of people and receipts from before it (MOL-275): everyone already there has the trial's ten, a
 * receipt the month of its arrival in Yerevan, an image rolled back past it still writes a receipt — the month its
 * default — and the counts move no one's `updated_at`.
 *
 * Its own database, created and dropped here, as in `migration-0073.integration.test.ts`: the chain has to be left one
 * step short of 0089. Rows are written by SQL of their own — the schema of now names the columns 0089 adds.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_0089`
const maintenance = new URL(url.toString())
maintenance.pathname = '/postgres'
const ownUrl = new URL(url.toString())
ownUrl.pathname = `/${database}`

let admin: Sql
let sql: Sql

async function apply(entry: JournalEntry): Promise<void> {
  const file = readFileSync(`${MIGRATIONS}/${entry.tag}.sql`, 'utf8')
  for (const statement of file.split('--> statement-breakpoint')) {
    if (statement.trim() === '') continue
    await sql.unsafe(statement)
  }
}

beforeAll(async () => {
  admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
  await admin.unsafe(`drop database if exists "${database}"`)
  await admin.unsafe(`create database "${database}"`)
  sql = postgres(ownUrl.toString(), { max: 1, onnotice: () => undefined })
})

afterAll(async () => {
  await sql.end()
  await admin.unsafe(`drop database if exists "${database}"`)
  await admin.end()
})

const UPDATED = '2026-09-27T10:00:00.000Z'

async function owner(): Promise<string> {
  const id = randomUUID()
  await sql`
    insert into actors (id, telegram_user_id, country, city, spend_currency, income_currency, created_at, updated_at)
    values (${id}, ${telegramId()}, 'AM', 'Гюмри', 'AMD', 'RUB', '2026-09-26T10:00:00.000Z', ${UPDATED})`
  return id
}

/** A receipt as an image before 0089 writes one: no month named. */
async function receipt(actorId: string, createdAt: string): Promise<string> {
  const id = randomUUID()
  await sql`
    insert into receipts (id, actor_id, status, parts, country, language, currency, captured_at, created_at)
    values (${id}, ${actorId}, 'uploading', 1, 'AM', 'ru', 'AMD', ${createdAt}, ${createdAt})`
  return id
}

const monthOf = async (id: string) =>
  onlyRow(
    await sql<{ month: string }[]>`select sent_month::text as month from receipts where id = ${id}`,
  )?.month

describe('0089: the trial and the months of everything already there', () => {
  it('gives everyone the ten, each receipt Yerevan’s month of its arrival, and moves no `updated_at`', async () => {
    const before = journal.entries.filter((entry) => entry.idx < 89)
    const [own] = journal.entries.filter((entry) => entry.idx === 89)
    if (own === undefined) throw new Error('0089 is not in the journal')
    expect(own.tag).toBe('0089_receipts_access')
    for (const entry of before) await apply(entry)

    const anna = await owner()
    // 21:00 of the 31st in UTC is the 1st of November in Yerevan, an hour past its midnight
    const night = await receipt(anna, '2026-10-31T21:00:00.000Z')
    const evening = await receipt(anna, '2026-10-31T19:59:59.000Z')
    await apply(own)

    expect(
      onlyRow(
        await sql<{ trial: number; read: number; month: string | null; updated: Date }[]>`
          select trial_receipts_left as trial, model_receipts_read as read, model_receipts_month as month,
            updated_at as updated
          from actors where id = ${anna}`,
      ),
    ).toEqual({ trial: 10, read: 0, month: null, updated: new Date(UPDATED) })
    expect(await monthOf(night)).toBe('2026-11-01')
    expect(await monthOf(evening)).toBe('2026-10-01')

    // an image rolled back past it names no month: the default is the month of now in Yerevan
    const rolledBack = await receipt(anna, new Date().toISOString())
    const now = onlyRow(
      await sql<{ month: string }[]>`
        select (date_trunc('month', now() at time zone 'Asia/Yerevan'))::date::text as month`,
    )
    expect(await monthOf(rolledBack)).toBe(now?.month)

    // a count is no change of the row
    await sql`
      update actors set trial_receipts_left = 9, model_receipts_read = 1, model_receipts_month = '2026-11-01'
      where id = ${anna}`
    const after = onlyRow(
      await sql<{ updated: Date }[]>`select updated_at as updated from actors where id = ${anna}`,
    )
    expect(after?.updated).toEqual(new Date(UPDATED))
  }, 60_000)

  it('refuses a trial past its ten or below nought, a count below nought, and a count of no kind', async () => {
    const boris = await owner()
    await expect(
      sql`update actors set trial_receipts_left = 11 where id = ${boris}`,
    ).rejects.toThrow(/actors_trial_receipts_left_known/u)
    await expect(
      sql`update actors set trial_receipts_left = -1 where id = ${boris}`,
    ).rejects.toThrow(/actors_trial_receipts_left_known/u)
    await expect(
      sql`update actors set model_receipts_read = -1 where id = ${boris}`,
    ).rejects.toThrow(/actors_model_receipts_read_not_negative/u)
    // a receipt is counted by the trial or by a place, or not at all
    const kept = await receipt(boris, new Date().toISOString())
    await expect(sql`update receipts set counted = 'free' where id = ${kept}`).rejects.toThrow(
      /receipts_counted_known/u,
    )
  }, 10_000)
})
