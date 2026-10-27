/**
 * MOL-238, адверсариальное ревью PR #234, раунд 2, атака Б1 — заполнение 0073 после правки А3. Зелёный тест
 * атаки = дефект жив.
 *
 * Правка А3 добавила ровно два названных источника — `items.created_by` и `item_barcodes.added_by`. Остались
 * моменты, которые человек ставит в приложении позже записи, а заполнение их не читает: «Списано со счёта»
 * у старого похода (`trips.account_set_at`, `PUT /trips/:id/payment`) и счёт, убранный в архив
 * (`money_accounts.archived_at`). У того, кто вышел со всех устройств, часы двух лет начинаются с июня, хотя
 * в октябре он был в приложении.
 *
 * Своя база с цепочкой до 0072, затем 0073 — как `migration-0073.integration.test.ts`; вторая база — мутант
 * m2. Кладётся в `backend/tests/`, гоняется в CI (ветка мутаций), локально не гоняется.
 */
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

interface JournalEntry {
  readonly idx: number
  readonly tag: string
}

const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, 'utf8')) as {
  entries: readonly JournalEntry[]
}

const url = new URL(testDatabaseUrl())
const maintenance = new URL(url.toString())
maintenance.pathname = '/postgres'

/** m2 — правка, которой атака краснеет: поход и счёт читают и поздние свои моменты. */
const TRIPS = `(SELECT max(greatest("t"."started_at", "t"."finished_at")) FROM "trips" AS "t" WHERE "t"."actor_id" = "a"."id")`
const TRIPS_M2 = `(SELECT max(greatest("t"."started_at", "t"."finished_at", "t"."account_set_at")) FROM "trips" AS "t" WHERE "t"."actor_id" = "a"."id")`
const ACCOUNTS = `(SELECT max("created_at") FROM "money_accounts" WHERE "actor_id" = "a"."id")`
const ACCOUNTS_M2 = `(SELECT max(greatest("created_at", "archived_at")) FROM "money_accounts" WHERE "actor_id" = "a"."id")`

function migration(tag: string, mutant: boolean): string {
  const file = readFileSync(`${MIGRATIONS}/${tag}.sql`, 'utf8')
  if (!mutant || tag !== '0073_actor_last_seen') return file
  // the fix of PR #234 (6e45d766) reads the late moments itself: then the mutant is the file as it is
  if (file.includes('"t"."account_set_at"') && file.includes('greatest("created_at", "archived_at"')) return file
  if (!file.includes(TRIPS) || !file.includes(ACCOUNTS)) {
    throw new Error('0073 changed: the mutant has nothing to replace')
  }
  return file.replace(TRIPS, TRIPS_M2).replace(ACCOUNTS, ACCOUNTS_M2)
}

const CREATED = '2026-03-01T10:00:00.000Z'
/** Последнее, что человек записал: поход и счёт. */
const IN_JUNE = '2026-06-01T08:00:00.000Z'
/** Позже — в приложении, но не новой записью. */
const IN_OCTOBER = '2026-10-10T08:00:00.000Z'

interface Owners {
  readonly purchaseLater: string
  readonly debitedLater: string
  readonly archivedLater: string
}

interface Copy {
  readonly sql: Sql
  readonly owners: Owners
}

let admin: Sql
let original: Copy
let mutant: Copy
/** Every database made, so `afterAll` drops it even where `prepare` failed halfway. */
const opened: { readonly name: string; readonly sql: Sql }[] = []

async function prepare(name: string, mutated: boolean): Promise<Copy> {
  await admin.unsafe(`drop database if exists "${name}"`)
  await admin.unsafe(`create database "${name}"`)
  const own = new URL(url.toString())
  own.pathname = `/${name}`
  const sql = postgres(own.toString(), { max: 1, onnotice: () => undefined })
  opened.push({ name, sql })

  async function apply(entry: JournalEntry): Promise<void> {
    for (const statement of migration(entry.tag, mutated).split('--> statement-breakpoint')) {
      if (statement.trim() === '') continue
      await sql.unsafe(statement)
    }
  }

  async function owner(): Promise<string> {
    const id = randomUUID()
    await sql`
      insert into actors (id, telegram_user_id, country, city, spend_currency, income_currency, created_at, updated_at)
      values (${id}, ${telegramId()}, 'AM', 'Гюмри', 'AMD', 'RUB', ${CREATED}, ${CREATED})`
    return id
  }

  /** Счёт в драмах, заведённый в июне; `archivedAt` — когда его убрали в архив. */
  async function account(actorId: string, archivedAt: string | null = null): Promise<string> {
    const id = randomUUID()
    await sql`
      insert into money_accounts (id, actor_id, name, currency, start_minor, start_on, created_on, created_at, archived_at)
      values (${id}, ${actorId}, 'Карта', 'AMD', 0, '2026-06-01', '2026-06-01', ${IN_JUNE}, ${archivedAt})`
    return id
  }

  const own73 = journal.entries.find((entry) => entry.idx === 73)
  if (own73?.tag !== '0073_actor_last_seen') throw new Error('0073 is not in the journal')
  for (const entry of journal.entries.filter((each) => each.idx < 73)) await apply(entry)
  const db = drizzle(sql, { schema })
  const place = await insertPlace(db)
  const milk = await insertItem(db)

  // К4, контроль: вышел со всех устройств; поход в июне, покупка дописана в октябре — запись видна
  const purchaseLater = await owner()
  await account(purchaseLater)
  const trip = await insertTrip(db, {
    actorId: purchaseLater,
    placeId: place,
    startedAt: new Date(IN_JUNE),
  })
  await db
    .insert(expenses)
    .values({ id: randomUUID(), tripId: trip, itemId: milk, createdAt: new Date(IN_OCTOBER) })

  // Б1а: поход и счёт в июне; в октябре в «Покупках» поход поставлен на счёт («Списано со счёта»)
  const debitedLater = await owner()
  const card = await account(debitedLater)
  await insertTrip(db, {
    actorId: debitedLater,
    placeId: place,
    startedAt: new Date(IN_JUNE),
    accountId: card,
    accountSetAt: new Date(IN_OCTOBER),
  })

  // Б1б: поход и счёт в июне; в октябре счёт убран в архив в «Счетах»
  const archivedLater = await owner()
  await account(archivedLater, IN_OCTOBER)
  await insertTrip(db, { actorId: archivedLater, placeId: place, startedAt: new Date(IN_JUNE) })

  await apply(own73)
  return { sql, owners: { purchaseLater, debitedLater, archivedLater } }
}

async function seenOf(copy: Copy, id: string): Promise<string> {
  const [row] = await copy.sql<{ seen: string }[]>`
    select last_seen_at as seen from actors where id = ${id}`
  if (row === undefined) throw new Error('the owner is gone')
  return new Date(row.seen).toISOString()
}

beforeAll(async () => {
  admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
  original = await prepare(`${url.pathname.slice(1)}_0073_round2`, false)
  mutant = await prepare(`${url.pathname.slice(1)}_0073_round2_m2`, true)
}, 120_000)

afterAll(async () => {
  for (const copy of opened) {
    await copy.sql.end()
    await admin.unsafe(`drop database if exists "${copy.name}"`)
  }
  await admin.end()
})

describe('MOL-238 раунд 2, атака Б1: заполнение 0073 не видит поздних моментов похода и счёта', () => {
  it('К4, контроль: покупка, дописанная в октябре, — визит октябрьский', async () => {
    expect(await seenOf(original, original.owners.purchaseLater)).toBe(IN_OCTOBER)
  })

  it('Б1а: «Списано со счёта» в октябре не визит — визит июньский', async () => {
    expect(await seenOf(original, original.owners.debitedLater)).toBe(IN_JUNE)
  })

  it('Б1б: счёт, убранный в архив в октябре, не визит — визит июньский', async () => {
    expect(await seenOf(original, original.owners.archivedLater)).toBe(IN_JUNE)
  })
})

describe('m2 — 0073 с правкой: Б1 краснеет, контроль нет (зелёный = правка закрывает)', () => {
  it('К4 под m2: октябрьский', async () => {
    expect(await seenOf(mutant, mutant.owners.purchaseLater)).toBe(IN_OCTOBER)
  })

  it('Б1 под m2: «Списано со счёта» и архив — визит октябрьский', async () => {
    expect(await seenOf(mutant, mutant.owners.debitedLater)).toBe(IN_OCTOBER)
    expect(await seenOf(mutant, mutant.owners.archivedLater)).toBe(IN_OCTOBER)
  })
})
