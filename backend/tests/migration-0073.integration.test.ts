import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { testDatabaseUrl } from './db'
import { insertItem, insertPlace, insertTrip, telegramId } from './fixtures'
import { MIGRATIONS } from '@/db/migrate'
import * as schema from '@/db/schema'
import { expenses } from '@/db/schema'

/**
 * 0073 on a database of people from before it (MOL-238): the last visit is the latest the server knows
 * of each in the app — a session's use, else a record of theirs, the catalogue's included, or a later
 * moment of one (an account set, a removal, the archive), else the moment the account appeared; a
 * reply through the bot is none (В-1 «а») — and the fill moves no one's `updated_at`, since the
 * trigger stops seeing the column before it runs.
 *
 * Its own database, created and dropped here, as in `migration-0061.integration.test.ts`: the chain
 * has to be left one step short of 0073. The owners and the sessions are written by SQL of their own —
 * the schema of now names the column 0073 adds.
 */
interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const database = `${url.pathname.slice(1)}_0073`
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

const CREATED = '2026-09-26T10:00:00.000Z'
const UPDATED = '2026-09-27T10:00:00.000Z'

async function owner(): Promise<string> {
  const id = randomUUID()
  await sql`
    insert into actors (id, telegram_user_id, country, city, spend_currency, income_currency, created_at, updated_at)
    values (${id}, ${telegramId()}, 'AM', 'Гюмри', 'AMD', 'RUB', ${CREATED}, ${UPDATED})`
  return id
}

async function session(actorId: string, lastSeenAt: string): Promise<void> {
  await sql`
    insert into sessions (id, actor_id, token_hash, last_seen_at, expires_at)
    values (${randomUUID()}, ${actorId}, ${randomUUID().replaceAll('-', '').repeat(2)},
      ${lastSeenAt}, now() + interval '1 day')`
}

/** A message from the app's sheet at `at`, the owner's reply a day later — the thread a continuation names. */
async function messageFromApp(
  actorId: string,
  at: string,
): Promise<{ head: string; reply: string }> {
  const [head] = await sql<{ id: string }[]>`
    insert into feedback (actor_id, kind, text, locale, api_build, created_at)
    values (${actorId}, 'bug', 'Не открывается чек', 'ru', 'test', ${at})
    returning id`
  if (head === undefined) throw new Error('no message')
  const [reply] = await sql<{ id: string }[]>`
    insert into feedback_replies (feedback_id, actor_id, thread_id, text, created_at)
    values (${head.id}, ${actorId}, ${head.id}, 'Пришлите фото', ${at}::timestamptz + interval '1 day')
    returning id`
  if (reply === undefined) throw new Error('no reply')
  return { head: head.id, reply: reply.id }
}

async function seenOf(id: string): Promise<{ seen: string; updated: string }> {
  const [row] = await sql<{ seen: string; updated: string }[]>`
    select last_seen_at as seen, updated_at as updated from actors where id = ${id}`
  if (row === undefined) throw new Error('the owner is gone')
  return { seen: new Date(row.seen).toISOString(), updated: new Date(row.updated).toISOString() }
}

describe('0073: the last visit of everyone already there', () => {
  it('takes the latest the server knows of each, and moves no `updated_at`', async () => {
    const before = journal.entries.filter((entry) => entry.idx < 73)
    const [own] = journal.entries.filter((entry) => entry.idx === 73)
    if (own === undefined) throw new Error('0073 is not in the journal')
    expect(own.tag).toBe('0073_actor_last_seen')
    for (const entry of before) await apply(entry)
    const db = drizzle(sql, { schema })
    const place = await insertPlace(db)
    const milk = await insertItem(db)

    // a session used on the 20th, a trip started before it: the session
    const withSession = await owner()
    await session(withSession, '2026-10-20T08:00:00.000Z')
    await insertTrip(db, {
      actorId: withSession,
      placeId: place,
      startedAt: new Date('2026-10-01T08:00:00.000Z'),
    })
    // two sessions: the later one
    const twoSessions = await owner()
    await session(twoSessions, '2026-10-02T08:00:00.000Z')
    await session(twoSessions, '2026-10-12T08:00:00.000Z')
    // a session used on the 3rd, a purchase written on the 5th: the record — a session marks its
    // use once a day, and a record is a visit as well
    const recordLater = await owner()
    await session(recordLater, '2026-10-03T08:00:00.000Z')
    const trip = await insertTrip(db, {
      actorId: recordLater,
      placeId: place,
      startedAt: new Date('2026-10-03T08:00:00.000Z'),
    })
    await db.insert(expenses).values({
      id: randomUUID(),
      tripId: trip,
      itemId: milk,
      createdAt: new Date('2026-10-05T08:00:00.000Z'),
    })
    // signed out everywhere — no session — but a trip of the 15th
    const noSession = await owner()
    await insertTrip(db, {
      actorId: noSession,
      placeId: place,
      startedAt: new Date('2026-10-15T08:00:00.000Z'),
    })
    // nothing at all: the moment the account appeared
    const nothing = await owner()
    // a word to the developer from the app's sheet on the 4th is a visit
    const fromApp = await owner()
    await messageFromApp(fromApp, '2026-10-04T08:00:00.000Z')
    // a reply to the owner in Telegram on the 16th is the bot's, not one (В-1 «а»): the sheet's 4th
    const inTelegram = await owner()
    const thread = await messageFromApp(inTelegram, '2026-10-04T08:00:00.000Z')
    await sql`
      insert into feedback (actor_id, kind, text, locale, api_build, thread_id, in_reply_to, created_at)
      values (${inTelegram}, 'bug', 'Вот фото', 'ru', 'test', ${thread.head}, ${thread.reply},
        '2026-10-16T08:00:00.000Z')`
    // signed out everywhere, then proposed an item on the 17th, or bound a code to one on the 18th
    const proposed = await owner()
    await insertItem(db, {
      name: 'Сыр «Лори»',
      searchKey: 'syr lori',
      createdBy: proposed,
      createdAt: new Date('2026-10-17T08:00:00.000Z'),
    })
    const bound = await owner()
    await sql`
      insert into item_barcodes (code, item_id, added_by, added_at)
      values ('4850001234567', ${milk}, ${bound}, '2026-10-18T08:00:00.000Z')`
    // a trip and a card of June, the trip put on the card on the 19th — in the app, after the record
    const debited = await owner()
    const [card] = await sql<{ id: string }[]>`
      insert into money_accounts (id, actor_id, name, currency, start_minor, start_on, created_on, created_at)
      values (${randomUUID()}, ${debited}, 'Карта', 'AMD', 0, '2026-06-01', '2026-06-01', '2026-06-01T08:00:00.000Z')
      returning id`
    await insertTrip(db, {
      actorId: debited,
      placeId: place,
      startedAt: new Date('2026-06-01T08:00:00.000Z'),
      accountId: card?.id,
      accountSetAt: new Date('2026-10-19T08:00:00.000Z'),
    })
    // a card of June put away on the 21st
    const archived = await owner()
    await sql`
      insert into money_accounts (id, actor_id, name, currency, start_minor, start_on, created_on, created_at, archived_at)
      values (${randomUUID()}, ${archived}, 'Карта', 'AMD', 0, '2026-06-01', '2026-06-01',
        '2026-06-01T08:00:00.000Z', '2026-10-21T08:00:00.000Z')`
    // a verdict of June withdrawn on the 22nd
    const withdrew = await owner()
    await sql`
      insert into verdicts (id, actor_id, item_id, item_kind, score, rated_at, updated_at, deleted_at)
      values (${randomUUID()}, ${withdrew}, ${milk}, 'product', 4, '2026-06-01T08:00:00.000Z',
        '2026-06-01T08:00:00.000Z', '2026-10-22T08:00:00.000Z')`
    // a trip whose phone's clock ran a year ahead: never later than the migration itself
    const ahead = await owner()
    await insertTrip(db, {
      actorId: ahead,
      placeId: place,
      startedAt: new Date(Date.now() + 365 * 86_400_000),
    })

    const started = Date.now()
    await apply(own)

    expect(await seenOf(withSession)).toEqual({
      seen: '2026-10-20T08:00:00.000Z',
      updated: UPDATED,
    })
    expect(await seenOf(twoSessions)).toEqual({
      seen: '2026-10-12T08:00:00.000Z',
      updated: UPDATED,
    })
    expect(await seenOf(recordLater)).toEqual({
      seen: '2026-10-05T08:00:00.000Z',
      updated: UPDATED,
    })
    expect(await seenOf(noSession)).toEqual({ seen: '2026-10-15T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(nothing)).toEqual({ seen: CREATED, updated: UPDATED })
    expect(await seenOf(fromApp)).toEqual({ seen: '2026-10-04T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(inTelegram)).toEqual({ seen: '2026-10-04T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(proposed)).toEqual({ seen: '2026-10-17T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(bound)).toEqual({ seen: '2026-10-18T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(debited)).toEqual({ seen: '2026-10-19T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(archived)).toEqual({ seen: '2026-10-21T08:00:00.000Z', updated: UPDATED })
    expect(await seenOf(withdrew)).toEqual({ seen: '2026-10-22T08:00:00.000Z', updated: UPDATED })
    const capped = await seenOf(ahead)
    expect(new Date(capped.seen).getTime()).toBeLessThanOrEqual(Date.now())
    expect(new Date(capped.seen).getTime()).toBeGreaterThanOrEqual(started - 60_000)

    // the column is the account's from now on: required, and set by itself for a new one
    const fresh = randomUUID()
    await sql`
      insert into actors (id, telegram_user_id, country, city, spend_currency, income_currency)
      values (${fresh}, ${telegramId()}, 'AM', 'Гюмри', 'AMD', 'RUB')`
    const [made] = await sql<{ same: boolean }[]>`
      select last_seen_at = created_at as same from actors where id = ${fresh}`
    expect(made).toEqual({ same: true })
    await expect(sql`update actors set last_seen_at = null where id = ${fresh}`).rejects.toThrow(
      /not-null|null value/,
    )

    // a visit is not a change of the row; a change of the settings still is
    await sql`update actors set last_seen_at = now() where id = ${nothing}`
    expect((await seenOf(nothing)).updated).toBe(UPDATED)
    await sql`update actors set city = 'Ереван' where id = ${nothing}`
    expect((await seenOf(nothing)).updated).not.toBe(UPDATED)
  }, 60_000)
})
