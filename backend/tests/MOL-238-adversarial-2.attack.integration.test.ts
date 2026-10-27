/**
 * MOL-238, адверсариальное ревью PR #234, атаки А2 и А3 — заполнение 0073. Зелёный тест атаки = дефект жив.
 *
 * А2: В-1 «а» владельца — визит только в приложении, «ответ разработчику визитом не считается». Продолжение
 * нити (`feedback.thread_id is not null`) по схеме и есть ответ в Telegram (`feedback_continuation_answers`:
 * «the person replies in Telegram»), то есть строку бота видно. Заполнение берёт `max(created_at)` из всего
 * `feedback` и делает ответ через бота последним визитом.
 *
 * А3: «самое позднее, что известно о человеке» не видит того, что человек сделал в приложении и записал
 * под своим id: товар, предложенный через «Предложить товар» (`items.created_by`), и штрихкод, привязанный
 * к товару (`item_barcodes.added_by`, MOL-100). Вышел со всех устройств — часы двух лет начинаются раньше
 * настоящего визита.
 *
 * Своя база, как в `migration-0073.integration.test.ts` PR: цепочка до 0072, строки, затем 0073. Кладётся
 * в `backend/tests/`, гоняется в CI (ветка мутаций), локально не гоняется.
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

/**
 * m1 — правка, которой атаки краснеют: продолжение нити не визит, товар и штрихкод человека — визит.
 * Тот же 0073, три подзапроса заменены строкой. Своя база, те же строки.
 */
const FEEDBACK_ALL = `(SELECT max("created_at") FROM "feedback" WHERE "actor_id" = "a"."id")`
const FEEDBACK_IN_APP = `(SELECT max("created_at") FROM "feedback" WHERE "actor_id" = "a"."id" AND "thread_id" IS NULL),
  (SELECT max("created_at") FROM "items" WHERE "created_by" = "a"."id"),
  (SELECT max("added_at") FROM "item_barcodes" WHERE "added_by" = "a"."id")`

function migration(tag: string, mutant: boolean): string {
  const file = readFileSync(`${MIGRATIONS}/${tag}.sql`, 'utf8')
  if (!mutant || tag !== '0073_actor_last_seen') return file
  if (!file.includes(FEEDBACK_ALL)) throw new Error('0073 changed: the mutant has nothing to replace')
  return file.replace(FEEDBACK_ALL, FEEDBACK_IN_APP)
}

const CREATED = '2026-03-01T10:00:00.000Z'
/** Последнее использование сессии — или последняя покупка у того, кто вышел со всех устройств. */
const IN_APP = '2026-06-01T08:00:00.000Z'
/** Позже всего, что человек делал в приложении. */
const LATER = '2026-10-10T08:00:00.000Z'

interface Owners {
  readonly botContinuation: string
  readonly appOnly: string
  readonly proposedAnItem: string
  readonly boundACode: string
}

interface Copy {
  readonly name: string
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

  async function session(actorId: string, lastSeenAt: string): Promise<void> {
    await sql`
      insert into sessions (id, actor_id, token_hash, last_seen_at, expires_at)
      values (${randomUUID()}, ${actorId}, ${randomUUID().replaceAll('-', '').repeat(2)},
        ${lastSeenAt}, now() + interval '1 day')`
  }

  /** Первое сообщение из шторки приложения в `at`; ответ владельца через день. */
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

  /** Продолжение нити — ответ человека в Telegram на сообщение владельца, через бота. */
  async function continuationInTelegram(
    actorId: string,
    thread: { head: string; reply: string },
    at: string,
  ): Promise<void> {
    await sql`
      insert into feedback (actor_id, kind, text, locale, api_build, thread_id, in_reply_to, created_at)
      values (${actorId}, 'bug', 'Вот фото', 'ru', 'test', ${thread.head}, ${thread.reply}, ${at})`
  }

  const own73 = journal.entries.find((entry) => entry.idx === 73)
  if (own73?.tag !== '0073_actor_last_seen') throw new Error('0073 is not in the journal')
  for (const entry of journal.entries.filter((each) => each.idx < 73)) await apply(entry)
  const db = drizzle(sql, { schema })
  const place = await insertPlace(db)

  // А2: сессия в июне, тогда же сообщение из шторки; в октябре — ответ владельцу в Telegram
  const botContinuation = await owner()
  await session(botContinuation, IN_APP)
  await continuationInTelegram(
    botContinuation,
    await messageFromApp(botContinuation, IN_APP),
    LATER,
  )
  // контроль А2: та же нить без ответа в Telegram
  const appOnly = await owner()
  await session(appOnly, IN_APP)
  await messageFromApp(appOnly, IN_APP)

  // А3: вышел со всех устройств; последняя покупка в июне, в октябре предложил товар
  const proposedAnItem = await owner()
  await insertTrip(db, { actorId: proposedAnItem, placeId: place, startedAt: new Date(IN_APP) })
  await insertItem(db, {
    name: 'Сыр «Лори»',
    searchKey: 'syr lori',
    createdBy: proposedAnItem,
    createdAt: new Date(LATER),
  })
  // А3: вышел со всех устройств; последняя покупка в июне, в октябре привязал штрихкод
  const boundACode = await owner()
  await insertTrip(db, { actorId: boundACode, placeId: place, startedAt: new Date(IN_APP) })
  const milk = await insertItem(db)
  await sql`
    insert into item_barcodes (code, item_id, added_by, added_at)
    values ('4850001234567', ${milk}, ${boundACode}, ${LATER})`

  await apply(own73)
  return { name, sql, owners: { botContinuation, appOnly, proposedAnItem, boundACode } }
}

async function seenOf(copy: Copy, id: string): Promise<string> {
  const [row] = await copy.sql<{ seen: string }[]>`
    select last_seen_at as seen from actors where id = ${id}`
  if (row === undefined) throw new Error('the owner is gone')
  return new Date(row.seen).toISOString()
}

beforeAll(async () => {
  admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined })
  original = await prepare(`${url.pathname.slice(1)}_0073_attack`, false)
  mutant = await prepare(`${url.pathname.slice(1)}_0073_mutant`, true)
}, 120_000)

afterAll(async () => {
  for (const copy of opened) {
    await copy.sql.end()
    await admin.unsafe(`drop database if exists "${copy.name}"`)
  }
  await admin.end()
})

describe('MOL-238 атака А2: ответ разработчику через бота — визит в заполнении 0073', () => {
  it('К3, контроль: нить из приложения без ответа в Telegram — визит июньский', async () => {
    expect(await seenOf(original, original.owners.appOnly)).toBe(IN_APP)
  })

  it('А2: ответ в Telegram, `thread_id is not null`, становится последним визитом', async () => {
    expect(await seenOf(original, original.owners.botContinuation)).toBe(LATER)
  })
})

describe('MOL-238 атака А3: заполнение 0073 не видит записей человека в каталоге', () => {
  it('А3а: товар, предложенный в октябре, не визит — визит июньский', async () => {
    expect(await seenOf(original, original.owners.proposedAnItem)).toBe(IN_APP)
  })

  it('А3б: штрихкод, привязанный в октябре, не визит — визит июньский', async () => {
    expect(await seenOf(original, original.owners.boundACode)).toBe(IN_APP)
  })
})

describe('m1 — 0073 с правкой: атаки А2 и А3 краснеют, контроль нет (зелёный = правка закрывает)', () => {
  it('К3 под m1: нить из приложения — визит июньский', async () => {
    expect(await seenOf(mutant, mutant.owners.appOnly)).toBe(IN_APP)
  })

  it('А2 под m1: ответ в Telegram не визит', async () => {
    expect(await seenOf(mutant, mutant.owners.botContinuation)).toBe(IN_APP)
  })

  it('А3 под m1: товар и штрихкод — визит', async () => {
    expect(await seenOf(mutant, mutant.owners.proposedAnItem)).toBe(LATER)
    expect(await seenOf(mutant, mutant.owners.boundACode)).toBe(LATER)
  })
})
