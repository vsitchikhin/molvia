/**
 * The two doors of the catalogue, through the server rather than around it: the hook, the
 * query and body seams, the use cases, the central error handler and the wire contract all
 * take part. This is the contract, not the quality of the search — ranking over a corpus is
 * MOL-13's, and the order here is only compared with what the repository itself answers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  CATALOGUE_QUERY_MAX,
  ERROR,
  ISSUE,
  barcodeTakenSchema,
  catalogueEntryCodec,
  SESSION_COOKIE,
  catalogueBarcodeResponseSchema,
  catalogueSearchResponseSchema,
} from '@molvia/model'
import type { CatalogueEntry, NewItem } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { events, itemBarcodes, items, searchPicks } from '@/db/schema'
import { createItemRepository } from '@/db/items-repository'
import { createSearchPickRepository } from '@/db/search-picks-repository'
import { SEARCH_LIMIT } from '@/usecases/search-catalogue'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { aStrangersCookie, clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createItemRepository(db)
const picks = createSearchPickRepository(db)

let app: FastifyInstance

beforeAll(async () => {
  // Pointed at the test database: otherwise the server writes into the one entered by hand.
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

interface Reply {
  readonly status: number
  readonly raw: string
  readonly body: unknown
  readonly headers: Record<string, unknown>
}

async function search(actor: string | null, query: string): Promise<Reply> {
  const response = await app.inject({
    method: 'GET',
    url: `/catalogue/search${query}`,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
  })
  return {
    status: response.statusCode,
    raw: response.body,
    body: JSON.parse(response.body) as unknown,
    headers: response.headers,
  }
}

const q = (text: string) => `?q=${encodeURIComponent(text)}`

async function propose(actor: string | null, body: unknown): Promise<Reply> {
  const response = await app.inject({
    method: 'POST',
    url: '/catalogue/items',
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
    payload: body as Record<string, unknown>,
  })
  return {
    status: response.statusCode,
    raw: response.body,
    body: JSON.parse(response.body) as unknown,
    headers: response.headers,
  }
}

/** Read through the contract the client parses — a server that drifted from it fails here. */
function found(reply: Reply): CatalogueEntry[] {
  expect(reply.status).toBe(200)
  return catalogueSearchResponseSchema.parse(reply.body).items
}

const ids = (entries: readonly { id: string }[]) => entries.map((entry) => entry.id)

async function add(input: Partial<NewItem> & { name: string }, createdBy: string | null = null) {
  return repository.create({ kind: 'product', defaultUnit: 'l', barcodes: [], ...input }, createdBy)
}

async function viewsOf(actorId: string) {
  return db.select().from(events).where(eq(events.actorId, actorId))
}

describe('GET /catalogue/search — the door', () => {
  it('answers no header, a malformed one and an unknown one identically, before any work', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Молоко «Ашхар»' })

    // Не через `search`: тот входит за названного владельца, а здесь проверяется как раз то,
    // что владельца никто не назвал — ни cookie, ни негодной, ни чужой.
    const asked = async (cookie?: string) => {
      const response = await app.inject({
        method: 'GET',
        url: `/catalogue/search${q('молоко')}`,
        headers: cookie === undefined ? {} : { cookie },
      })
      return {
        status: response.statusCode,
        raw: response.body,
        body: JSON.parse(response.body) as unknown,
      }
    }
    const missing = await asked()
    const malformed = await asked(`${SESSION_COOKIE}=not-a-token`)
    const unknown = await asked(aStrangersCookie())

    expect(missing.status).toBe(401)
    expect(missing.body).toEqual({ code: ERROR.NO_ACTOR })
    expect(malformed.raw).toBe(missing.raw)
    expect(unknown.raw).toBe(missing.raw)
    // Nobody named, so nobody visited: the log stays empty.
    expect(await db.select().from(events)).toHaveLength(0)
    expect(await viewsOf(actor)).toHaveLength(0)
  })

  it('never takes the owner from the query string', async () => {
    const mine = await insertActor(db)
    const theirs = await insertActor(db)

    const reply = await search(theirs, `${q('молоко')}&actorId=${mine}`)

    expect(reply.status).toBe(400)
    expect(reply.body).toEqual({ code: ISSUE.QUERY_INVALID, details: 'actorId' })
  })

  it('has no HEAD twin that would search and count as a visit', async () => {
    const actor = await insertActor(db)

    const response = await app.inject({
      method: 'HEAD',
      url: `/catalogue/search${q('молоко')}`,
      headers: { cookie: await signIn(db, actor) },
    })

    expect(response.statusCode).toBe(404)
    expect(await viewsOf(actor)).toHaveLength(0)
  })
})

describe('GET /catalogue/search — the query', () => {
  it('refuses a missing or repeated query and names the field', async () => {
    const actor = await insertActor(db)

    for (const query of ['', '?q=a&q=b']) {
      const reply = await search(actor, query)
      expect(reply.status, query).toBe(400)
      expect(reply.body, query).toEqual({ code: ISSUE.QUERY_INVALID, details: 'q' })
    }
  })

  it('holds the length bound at exactly its edge', async () => {
    const actor = await insertActor(db)

    expect((await search(actor, q('м'.repeat(CATALOGUE_QUERY_MAX - 1)))).status).toBe(200)
    expect((await search(actor, q('м'.repeat(CATALOGUE_QUERY_MAX)))).status).toBe(200)
    expect((await search(actor, q('м'.repeat(CATALOGUE_QUERY_MAX + 1)))).status).toBe(400)
  })

  it('answers an empty, blank or punctuation-only query with nothing — not an error', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Молоко «Ашхар»' })

    for (const text of ['', '   ', '!!!']) {
      expect(found(await search(actor, q(text))), JSON.stringify(text)).toEqual([])
    }
  })

  it('answers nothing found with 200 and an empty list, not 404', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Молоко «Ашхар»' })

    expect(found(await search(actor, q('карбюратор')))).toEqual([])
  })

  it('reads + and %20 as a space', async () => {
    const actor = await insertActor(db)
    const milk = await add({ name: 'Молоко «Ашхар»' })

    const plus = found(
      await search(actor, `?q=${encodeURIComponent('молоко')}+${encodeURIComponent('ашхар')}`),
    )
    const encoded = found(await search(actor, q('молоко ашхар')))

    expect(ids(plus)).toEqual([milk.id])
    expect(plus).toEqual(encoded)
  })
})

describe('GET /catalogue/search — the answer', () => {
  it('answers in the order the repository ranks, through the wire contract', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Молоко «Ашхар» 3.2%' })
    await add({ name: 'Молоко «Марианна» 2.5%' })
    await add({ name: 'Молочный шоколад' })

    const reply = await search(actor, q('молоко'))
    const direct = (await repository.search('молоко', SEARCH_LIMIT, actor)).items

    expect(ids(found(reply))).toEqual(ids(direct))
    expect(found(reply).length).toBeGreaterThan(0)
  })

  it('says how near the answer is — far for a word the budget only grazes (MOL-46)', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Чай зелёный' })

    const far = await search(actor, q('пельмени'))
    const near = await search(actor, q('чай'))
    const none = await search(actor, q('бастурма'))

    expect(catalogueSearchResponseSchema.parse(far.body)).toMatchObject({ near: false })
    expect(found(far).map((entry) => entry.name)).toEqual(['Чай зелёный'])
    expect(catalogueSearchResponseSchema.parse(near.body)).toMatchObject({ near: true })
    expect(catalogueSearchResponseSchema.parse(none.body)).toEqual({ items: [], near: false })
  })

  it('finds a Cyrillic name typed in Latin, and an Armenian one sent percent-encoded', async () => {
    const actor = await insertActor(db)
    const milk = await add({ name: 'Молоко «Ашхар»' })
    const bread = await add({ name: 'Հաց Գյումրի', defaultUnit: 'piece' })

    expect(ids(found(await search(actor, q('moloko'))))).toContain(milk.id)
    expect(ids(found(await search(actor, q('Հաց'))))).toContain(bread.id)
  })

  it('shows an item someone else added, and never who added it', async () => {
    const reader = await insertActor(db)
    const author = await insertActor(db)
    const cheese = await add(
      { name: 'Сыр чанах', barcodes: ['4850001234567'], note: 'на развес', defaultUnit: 'kg' },
      author,
    )

    const reply = await search(reader, q('чанах'))

    expect(ids(found(reply))).toEqual([cheese.id])
    // The raw body, not the parsed one: the author's identifier is their account.
    expect(reply.raw).not.toContain(author)
    for (const field of ['createdBy', 'searchKey', 'barcodes', 'createdAt']) {
      expect(reply.raw).not.toContain(field)
    }
  })

  it('carries a typical quantity as a decimal string, and its absence as null', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Молоко «Ашхар»', typicalQuantity: { milli: 900n, unit: 'l' } })
    await add({ name: 'Молоко «Марианна»' })

    const reply = await search(actor, q('молоко'))
    const wire = (reply.body as { items: { name: string; typicalQuantity: unknown }[] }).items

    expect(wire.find((row) => row.name.includes('Ашхар'))?.typicalQuantity).toEqual({
      value: '0.900',
      unit: 'l',
    })
    expect(wire.find((row) => row.name.includes('Марианна'))?.typicalQuantity).toBeNull()
  })

  it('carries a dish counted in pieces without loss', async () => {
    const actor = await insertActor(db)
    const dish = await add({ kind: 'dish', name: 'Карбонара', defaultUnit: 'piece' })

    expect(found(await search(actor, q('карбонара')))).toEqual([
      {
        id: dish.id,
        kind: 'dish',
        name: 'Карбонара',
        note: null,
        defaultUnit: 'piece',
        typicalQuantity: null,
      },
    ])
  })

  it('stops at twenty: 19, 20 and 25 matches', async () => {
    const actor = await insertActor(db)
    for (const [count, expected] of [
      [19, 19],
      [20, 20],
      [25, 20],
    ] as const) {
      await db.delete(items)
      for (let n = 0; n < count; n += 1) await add({ name: `Молоко вариант ${String(n)}` })

      expect(found(await search(actor, q('молоко'))), String(count)).toHaveLength(expected)
    }
  })

  it('lifts the asker’s own pick, and nobody else’s', async () => {
    const mine = await insertActor(db)
    const theirs = await insertActor(db)
    await add({ name: 'Молоко «Ашхар»' })
    await add({ name: 'Молоко «Марианна»' })
    await add({ name: 'Молоко «Зовк»' })

    const before = ids(found(await search(theirs, q('молоко'))))
    const last = before.at(-1)
    if (last === undefined) throw new Error('nothing was found to pick')
    await picks.remember(mine, 'молоко', last)

    expect(ids(found(await search(mine, q('молоко'))))[0]).toBe(last)
    expect(ids(found(await search(theirs, q('молоко'))))).toEqual(before)
  })

  it('is never stored by a cache', async () => {
    const actor = await insertActor(db)

    expect((await search(actor, q('молоко'))).headers['cache-control']).toBe('no-store')
  })
})

describe('GET /catalogue/search — the event log', () => {
  it('writes nothing at all: the visit that answers the 0.3 gate is «Что брать»', async () => {
    // The search recorded `catalogue_viewed` from MOL-12 until MOL-31 (Р-18). It meant «came
    // back to enter a purchase», which was the honest reading while no screen showed anyone
    // else's data; now that one does, `advice_viewed` is the row the gate counts, and an
    // event nobody reads has no place in an append-only log.
    const actor = await insertActor(db)

    for (const text of ['м', 'мо', 'мол', 'молоко']) await search(actor, q(text))

    expect(await viewsOf(actor)).toHaveLength(0)
  })
})

async function byCode(actor: string | null, query: string): Promise<Reply> {
  const response = await app.inject({
    method: 'GET',
    url: `/catalogue/barcode${query}`,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
  })
  return {
    status: response.statusCode,
    raw: response.body,
    body: JSON.parse(response.body) as unknown,
    headers: response.headers,
  }
}

const code = (text: string) => `?code=${encodeURIComponent(text)}`

/** Read through the contract the client parses, as `found` reads the search. */
function held(reply: Reply): CatalogueEntry | null {
  expect(reply.status).toBe(200)
  return catalogueBarcodeResponseSchema.parse(reply.body).item
}

describe('GET /catalogue/barcode — the item a code belongs to (MOL-99)', () => {
  it('answers the item holding the code, as the catalogue shows it — never who added it', async () => {
    const author = await insertActor(db)
    const asker = await insertActor(db)
    const milk = await add({ name: 'Молоко «Ашхар» 1 л', barcodes: ['4850000000007'] }, author)

    const reply = await byCode(asker, code('4850000000007'))

    expect(held(reply)).toEqual({
      id: milk.id,
      kind: 'product',
      name: 'Молоко «Ашхар» 1 л',
      note: null,
      defaultUnit: 'l',
      typicalQuantity: null,
    })
    // Six fields and nothing else: not the author, and not the codes themselves.
    expect(reply.raw).not.toContain(author)
    expect(reply.raw).not.toContain('barcodes')
  })

  it('answers a code nobody holds with 200 and null, not 404', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Кефир', barcodes: ['4850000000007'] })

    expect(held(await byCode(actor, code('4850000000014')))).toBeNull()
  })

  it('answers a code of no barcode shape exactly as one nobody holds', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Кефир', barcodes: ['4850000000007'] })
    const nobodys = (await byCode(actor, code('4850000000014'))).raw

    for (const text of ['', '485000000000', '4850000000007 ', 'x850000000007', '048500000000071']) {
      const reply = await byCode(actor, code(text))
      expect(reply.status, text).toBe(200)
      expect(reply.raw, text).toBe(nobodys)
    }
  })

  it('finds a code typed from a shop label under the eight digits its scan stored (С-14)', async () => {
    const actor = await insertActor(db)
    const cheese = await add({ name: 'Сыр чечил', defaultUnit: 'kg', barcodes: ['00408295'] })
    const imported = await add({
      name: 'Crackers',
      defaultUnit: 'piece',
      barcodes: ['0100000000007'],
    })

    expect(held(await byCode(actor, code('0004082000095')))?.id).toBe(cheese.id)
    expect(held(await byCode(actor, code('00408295')))?.id).toBe(cheese.id)
    // And back: a UPC-E of system 1 scanned is thirteen digits, typed it is eight.
    expect(held(await byCode(actor, code('10000007')))?.id).toBe(imported.id)
  })

  it('prefers the code as read over its twin when both are held', async () => {
    const actor = await insertActor(db)
    const label = await add({
      name: 'Салат из магазина',
      defaultUnit: 'piece',
      barcodes: ['00408295'],
    })
    const upcE = await add({
      name: 'Imported beans',
      defaultUnit: 'piece',
      barcodes: ['0004082000095'],
    })

    expect(held(await byCode(actor, code('00408295')))?.id).toBe(label.id)
    expect(held(await byCode(actor, code('0004082000095')))?.id).toBe(upcE.id)
  })

  it('finds the package by the twelve digits of its UPC-A and by its GTIN-14 (adversarial З)', async () => {
    const actor = await insertActor(db)
    const tea = await add({ name: 'Tea', defaultUnit: 'piece', barcodes: ['0012345678905'] })

    expect(held(await byCode(actor, code('012345678905')))?.id).toBe(tea.id)
    expect(held(await byCode(actor, code('00012345678905')))?.id).toBe(tea.id)
  })

  it('does not guess between two shop labels that fold into one UPC-A (adversarial Г)', async () => {
    const actor = await insertActor(db)
    const cheese = await add({ name: 'Сыр, магазин 1', defaultUnit: 'kg', barcodes: ['00000055'] })
    await add({ name: 'Салат, магазин 2', defaultUnit: 'piece', barcodes: ['00000505'] })

    // Scanned, the label is its own eight digits; typed, it is thirteen that fit either label.
    expect(held(await byCode(actor, code('00000055')))?.id).toBe(cheese.id)
    expect(held(await byCode(actor, code('0000000000055')))).toBeNull()
  })

  it('does not find by a scanned label an item taken from the other one (adversarial Г′, С-7)', async () => {
    const actor = await insertActor(db)
    // Typed from its label 00000055, the cheese was taken as thirteen digits (typedBarcode).
    await add({ name: 'Сыр, магазин 1', defaultUnit: 'kg', barcodes: ['0000000000055'] })

    expect(held(await byCode(actor, code('00000505')))).toBeNull()
    expect(held(await byCode(actor, code('00000055')))).toBeNull()
    expect(held(await byCode(actor, code('0000000000055')))).not.toBeNull()
  })

  it('has no HEAD twin, as no GET of the API has (adversarial В)', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Кефир', barcodes: ['4850000000007'] })

    const response = await app.inject({
      method: 'HEAD',
      url: `/catalogue/barcode${code('4850000000007')}`,
      headers: { cookie: await signIn(db, actor) },
    })

    expect(response.statusCode).toBe(404)
  })

  it('must not find a twin for a code that has one form only', async () => {
    const actor = await insertActor(db)
    // 04252614 is UPC-E alone: its eight digits never stand for an EAN-8, so they are not looked up.
    await add({ name: 'Не тот товар', barcodes: ['04252614'] })

    expect(held(await byCode(actor, code('0042100005264')))).toBeNull()
  })

  it('refuses a missing, repeated or extra parameter and names it', async () => {
    const actor = await insertActor(db)

    expect((await byCode(actor, '')).status).toBe(400)
    expect((await byCode(actor, `${code('4850000000007')}&code=4850000000014`)).status).toBe(400)
    const extra = await byCode(actor, `${code('4850000000007')}&actorId=${actor}`)
    expect(extra.status).toBe(400)
    expect(extra.body).toEqual({ code: ISSUE.QUERY_INVALID, details: 'actorId' })
  })

  it('answers nobody named with the door, as the search does', async () => {
    const reply = await byCode(null, code('4850000000007'))

    expect(reply.status).toBe(401)
    expect(reply.body).toEqual({ code: ERROR.NO_ACTOR })
  })

  it('is never stored by a cache, and writes nothing — no event, no pick', async () => {
    const actor = await insertActor(db)
    await add({ name: 'Кефир', barcodes: ['4850000000007'] })

    const reply = await byCode(actor, code('4850000000007'))

    expect(reply.headers['cache-control']).toBe('no-store')
    expect(await viewsOf(actor)).toHaveLength(0)
    expect(await db.select().from(searchPicks)).toEqual([])
  })
})

describe('POST /catalogue/items — «Предложить товар»', () => {
  it('builds a key its own schema takes for a name around a glyph that draws nothing', async () => {
    // MOL-27, adversarial pass 3: U+13441 joined the name's list of «draws nothing» and not
    // the key's, and «𓑁!» — accepted as a name — answered 500 from building its own key.
    const actor = await insertActor(db)

    for (const name of ['\u{13441}!', '\u{1D159}?', '«\u{13441}»']) {
      const reply = await propose(actor, { kind: 'product', name, defaultUnit: 'piece' })
      expect(reply.status, name).toBe(201)
    }
  })

  const cheese = { kind: 'product', name: 'Сыр чанах Ашхар', defaultUnit: 'kg' }

  it('refuses a request that names no owner, and writes nothing', async () => {
    const reply = await propose(null, cheese)

    expect(reply.status).toBe(401)
    expect(await db.select().from(items)).toHaveLength(0)
  })

  it('creates the item in the name of the owner in the header, and does not say so', async () => {
    const actor = await insertActor(db)

    const reply = await propose(actor, {
      ...cheese,
      note: 'на развес',
      typicalQuantity: { value: '0.3', unit: 'kg' },
    })

    expect(reply.status).toBe(201)
    const entry = catalogueEntryCodec.parse(reply.body)
    expect(entry).toMatchObject({ kind: 'product', name: 'Сыр чанах Ашхар', note: 'на развес' })
    expect(entry.typicalQuantity).toEqual({ milli: 300n, unit: 'kg' })
    expect(reply.raw).not.toContain(actor)
    expect(reply.headers['cache-control']).toBe('no-store')

    const [row] = await db.select().from(items).where(eq(items.id, entry.id))
    expect(row?.createdBy).toBe(actor)
  })

  it('refuses a body that tries to name its own author or key', async () => {
    const actor = await insertActor(db)
    const other = await insertActor(db)

    for (const extra of [{ createdBy: other }, { searchKey: 'syr' }]) {
      const reply = await propose(actor, { ...cheese, ...extra })
      expect(reply.status, JSON.stringify(extra)).toBe(400)
    }
    expect(await db.select().from(items)).toHaveLength(0)
  })

  it('refuses a name with nothing visible and a fractional count of pieces', async () => {
    const actor = await insertActor(db)

    const blank = await propose(actor, { ...cheese, name: '​​' })
    const halfPiece = await propose(actor, {
      ...cheese,
      defaultUnit: 'piece',
      typicalQuantity: { value: '1.5', unit: 'piece' },
    })

    expect(blank.status).toBe(400)
    expect(blank.body).toMatchObject({ code: ISSUE.TEXT_NOT_VISIBLE, details: 'name' })
    expect(halfPiece.status).toBe(400)
    // Refused by the quantity codec already: precision below the unit's resolution (MOL-4).
    expect(halfPiece.body).toMatchObject({ code: ERROR.INVALID_QUANTITY })
    expect(await db.select().from(items)).toHaveLength(0)
  })

  it('returns the item already there instead of adding it twice', async () => {
    const actor = await insertActor(db)
    const other = await insertActor(db)

    const first = await propose(actor, cheese)
    const again = await propose(other, { ...cheese, name: 'сыр  чанах  ашхар', note: 'иначе' })

    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    const entry = catalogueEntryCodec.parse(again.body)
    expect(entry.id).toBe(catalogueEntryCodec.parse(first.body).id)
    // The existing item wins whole: the note sent the second time is not applied.
    expect(entry.note).toBeNull()
    expect(await db.select().from(items)).toHaveLength(1)
  })

  it('keeps two products whose search keys merely coincide apart', async () => {
    // The key folds on purpose — «Milo» and «Мыло» are one key — and a merge that costs the
    // search a candidate would cost this path the item: the drink could never be added.
    const actor = await insertActor(db)

    const soap = await propose(actor, { ...cheese, name: 'Мыло', defaultUnit: 'piece' })
    const drink = await propose(actor, { ...cheese, name: 'Milo', defaultUnit: 'kg' })
    const comma = await propose(actor, { ...cheese, name: 'Молоко 3,2%', defaultUnit: 'l' })
    const point = await propose(actor, { ...cheese, name: 'Молоко 3.2%', defaultUnit: 'l' })

    expect([soap.status, drink.status, comma.status, point.status]).toEqual([201, 201, 201, 201])
    expect(await db.select().from(items)).toHaveLength(4)
  })

  it('adds a double tap once: two requests at the same moment, one item', async () => {
    const actor = await insertActor(db)
    const other = connectDrizzle()
    const second = buildServer({ db: other.db })
    await second.ready()
    try {
      // Одна сессия на обе стороны: гонка тут между двумя серверами над одной базой, а не
      // между двумя входами — второй вход только добавил бы строку, ничего не проверяя.
      const cookie = await signIn(db, actor)
      const inject = (server: FastifyInstance) =>
        server.inject({
          method: 'POST',
          url: '/catalogue/items',
          headers: { cookie },
          payload: cheese,
        })
      const replies = await Promise.all([inject(app), inject(second)])

      expect(replies.map((reply) => reply.statusCode).sort()).toEqual([200, 201])
      expect(
        new Set(replies.map((reply) => (JSON.parse(reply.body) as { id: string }).id)).size,
      ).toBe(1)
      expect(await db.select().from(items)).toHaveLength(1)
    } finally {
      await second.close()
      await other.close()
    }
  })

  it('refuses a dish until 0.3, and writes nothing', async () => {
    // A dish would enter the log as a product forever: it waits for the release that needs it.
    const actor = await insertActor(db)

    const dish = await propose(actor, { ...cheese, kind: 'dish', defaultUnit: 'piece' })

    expect(dish.status).toBe(400)
    expect(dish.body).toMatchObject({ code: ISSUE.BODY_INVALID, details: 'kind' })
    expect(await db.select().from(items)).toHaveLength(0)
  })

  it('is found by the next search — its own author and anyone else, who never sees the author', async () => {
    const author = await insertActor(db)
    const reader = await insertActor(db)

    const entry = catalogueEntryCodec.parse((await propose(author, cheese)).body)

    expect(ids(found(await search(author, q('чанах'))))).toContain(entry.id)
    const theirs = await search(reader, q('чанах'))
    expect(ids(found(theirs))).toContain(entry.id)
    expect(theirs.raw).not.toContain(author)
  })
})

async function attach(actor: string | null, itemId: string, body: unknown): Promise<Reply> {
  const response = await app.inject({
    method: 'POST',
    url: `/catalogue/items/${itemId}/barcodes`,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
    payload: body as Record<string, unknown>,
  })
  return {
    status: response.statusCode,
    raw: response.body,
    body: JSON.parse(response.body) as unknown,
    headers: response.headers,
  }
}

async function detach(actor: string | null, itemId: string, query: string) {
  return app.inject({
    method: 'DELETE',
    url: `/catalogue/items/${itemId}/barcodes${query}`,
    headers: actor === null ? {} : { cookie: await signIn(db, actor) },
  })
}

async function codesOf(itemId: string) {
  return db
    .select({ code: itemBarcodes.code, addedBy: itemBarcodes.addedBy })
    .from(itemBarcodes)
    .where(eq(itemBarcodes.itemId, itemId))
    .orderBy(itemBarcodes.code)
}

// Codes whose check digit holds: a write refuses any other (MOL-100, Р-1).
const SOUR_CREAM = '4850001234562'
const KEFIR = '4850001234579'
const MILK = '4850001234586'

describe('POST /catalogue/items — with the codes read from the package (MOL-100)', () => {
  const sourCream = { kind: 'product', name: 'Сметана Ашхар 20%', defaultUnit: 'kg' }

  it('writes the item and its code together, in the name of who proposed it', async () => {
    const actor = await insertActor(db)
    const asker = await insertActor(db)

    const reply = await propose(actor, { ...sourCream, barcodes: [SOUR_CREAM] })

    expect(reply.status).toBe(201)
    const entry = catalogueEntryCodec.parse(reply.body)
    expect(reply.raw).not.toContain('barcodes')
    expect(await codesOf(entry.id)).toEqual([{ code: SOUR_CREAM, addedBy: actor }])
    expect(held(await byCode(asker, code(SOUR_CREAM)))?.id).toBe(entry.id)
  })

  it('writes twelve digits as the thirteen the scanner reads, found either way', async () => {
    const actor = await insertActor(db)

    const entry = catalogueEntryCodec.parse(
      (await propose(actor, { ...sourCream, barcodes: ['012345678905'] })).body,
    )

    expect(await codesOf(entry.id)).toEqual([{ code: '0012345678905', addedBy: actor }])
    expect(held(await byCode(actor, code('012345678905')))?.id).toBe(entry.id)
  })

  it('refuses a code whose check digit does not hold, and writes no item either', async () => {
    const actor = await insertActor(db)

    const reply = await propose(actor, { ...sourCream, barcodes: ['4850001234563'] })

    expect(reply.status).toBe(400)
    expect(reply.body).toEqual({ code: ERROR.BARCODE_CHECK_DIGIT })
    expect(await db.select().from(items)).toHaveLength(0)
  })

  it('refuses one package twice in the list — a code beside its twin (Р-7)', async () => {
    const actor = await insertActor(db)

    const reply = await propose(actor, { ...sourCream, barcodes: ['00408295', '0004082000095'] })

    expect(reply.status).toBe(400)
    expect(reply.body).toMatchObject({ code: ISSUE.BARCODE_DUPLICATED })
    expect(await db.select().from(items)).toHaveLength(0)
  })

  it('writes the code to the item already there under the same name (Р-4)', async () => {
    const author = await insertActor(db)
    const scanner = await insertActor(db)
    const first = catalogueEntryCodec.parse((await propose(author, sourCream)).body)

    const again = await propose(scanner, {
      ...sourCream,
      name: 'сметана  ашхар 20%',
      barcodes: [SOUR_CREAM],
    })

    expect(again.status).toBe(200)
    expect(catalogueEntryCodec.parse(again.body).id).toBe(first.id)
    expect(await codesOf(first.id)).toEqual([{ code: SOUR_CREAM, addedBy: scanner }])
    expect(await db.select().from(items)).toHaveLength(1)
  })

  it('answers the same code on the same item as there already — a repeat after a lost answer', async () => {
    const actor = await insertActor(db)
    const body = { ...sourCream, barcodes: [SOUR_CREAM] }
    const first = catalogueEntryCodec.parse((await propose(actor, body)).body)

    const again = await propose(actor, body)

    expect(again.status).toBe(200)
    expect(await codesOf(first.id)).toEqual([{ code: SOUR_CREAM, addedBy: actor }])
  })

  it('names the item that holds the code with a 409, and writes nothing (Р-3)', async () => {
    const author = await insertActor(db)
    const actor = await insertActor(db)
    const kefir = await add({ name: 'Кефир 1%', barcodes: [SOUR_CREAM] }, author)

    const reply = await propose(actor, { ...sourCream, barcodes: [SOUR_CREAM] })

    expect(reply.status).toBe(409)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(barcodeTakenSchema.parse(reply.body).taken).toMatchObject({
      id: kefir.id,
      name: 'Кефир 1%',
    })
    expect(reply.raw).not.toContain(author)
    expect(await db.select().from(items)).toHaveLength(1)
  })

  it('holds a code taken by its twin: the label typed as thirteen, held as eight (Р-2)', async () => {
    const actor = await insertActor(db)
    const cheese = await add({ name: 'Сыр чечил', defaultUnit: 'kg', barcodes: ['00408295'] })

    const reply = await propose(actor, { ...sourCream, barcodes: ['0004082000095'] })

    expect(reply.status).toBe(409)
    expect(barcodeTakenSchema.parse(reply.body).taken.id).toBe(cheese.id)
  })

  it('names the holder even beside a name already there, and writes that item no code', async () => {
    const actor = await insertActor(db)
    const first = catalogueEntryCodec.parse((await propose(actor, sourCream)).body)
    await add({ name: 'Кефир 1%', barcodes: [KEFIR] })

    const reply = await propose(actor, { ...sourCream, barcodes: [MILK, KEFIR] })

    expect(reply.status).toBe(409)
    expect(await codesOf(first.id)).toEqual([])
  })
})

describe('POST /catalogue/items — codes, the review (MOL-100)', () => {
  const withDigit = (body: string) => {
    let sum = 0
    for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
      sum += Number(body[i]) * weight
    }
    return `${body}${String((10 - (sum % 10)) % 10)}`
  }

  it('writes one package to one of two new items proposed at once, even through a twin', async () => {
    const actor = await insertActor(db)
    const other = connectDrizzle()
    const second = buildServer({ db: other.db })
    await second.ready()
    try {
      const cookie = await signIn(db, actor)
      const inject = (server: FastifyInstance, name: string, code: string) =>
        server.inject({
          method: 'POST',
          url: '/catalogue/items',
          headers: { cookie },
          payload: { kind: 'product', name, defaultUnit: 'kg', barcodes: [code] },
        })
      // Two names — two locks of the name — and one package, as its label and as its thirteen.
      const replies = await Promise.all([
        inject(app, 'Сыр чечил', '00408295'),
        inject(second, 'Сыр косичка', '0004082000095'),
      ])

      expect(replies.map((reply) => reply.statusCode).sort()).toEqual([201, 409])
      expect(await db.select().from(itemBarcodes)).toHaveLength(1)
      expect(await db.select().from(items)).toHaveLength(1)
    } finally {
      await second.close()
      await other.close()
    }
  })

  it('reaches twenty codes by a name already there, and refuses the twenty-first (Р-4, boundary)', async () => {
    const actor = await insertActor(db)
    const bodies = Array.from({ length: 19 }, (_, i) => `4852000000${String(i).padStart(2, '0')}`)
    const cream = await add({ name: 'Сметана', defaultUnit: 'kg', barcodes: bodies.map(withDigit) })
    const body = { kind: 'product', name: 'Сметана', defaultUnit: 'kg' }

    const two = await propose(actor, { ...body, barcodes: [SOUR_CREAM, KEFIR] })
    expect(two.status).toBe(409)
    expect(two.body).toEqual({ code: ERROR.BARCODES_FULL })
    expect(await codesOf(cream.id)).toHaveLength(19)

    const one = await propose(actor, { ...body, barcodes: [SOUR_CREAM] })
    expect(one.status).toBe(200)
    expect(await codesOf(cream.id)).toHaveLength(20)
  })

  it('writes eight digits that check only as UPC-E as the thirteen the scanner reads (review А)', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана' })

    const reply = await attach(actor, cream.id, { code: '04252614' })

    expect(reply.status).toBe(201)
    expect((await codesOf(cream.id)).map((row) => row.code)).toEqual(['0042100005264'])
    expect(held(await byCode(actor, code('0042100005264')))?.id).toBe(cream.id)
  })
})

describe('POST /catalogue/items/:itemId/barcodes — «привязать код к ней?» (MOL-100)', () => {
  it('writes the code to anyone’s item, in the name of who wrote it', async () => {
    const author = await insertActor(db)
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана Ашхар 20%', defaultUnit: 'kg' }, author)

    const reply = await attach(actor, cream.id, { code: SOUR_CREAM })

    expect(reply.status).toBe(201)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(catalogueEntryCodec.parse(reply.body).id).toBe(cream.id)
    expect(await codesOf(cream.id)).toEqual([{ code: SOUR_CREAM, addedBy: actor }])
    expect(held(await byCode(author, code(SOUR_CREAM)))?.id).toBe(cream.id)
  })

  it('answers a code the item holds already with 200, and keeps who wrote it first', async () => {
    const first = await insertActor(db)
    const second = await insertActor(db)
    const cream = await add({ name: 'Сметана' })
    await attach(first, cream.id, { code: SOUR_CREAM })

    const again = await attach(second, cream.id, { code: SOUR_CREAM })

    expect(again.status).toBe(200)
    expect(await codesOf(cream.id)).toEqual([{ code: SOUR_CREAM, addedBy: first }])
  })

  it('answers a code the item holds as its twin with 200, and writes no second form', async () => {
    const actor = await insertActor(db)
    const cheese = await add({ name: 'Сыр чечил', barcodes: ['00408295'] })

    const reply = await attach(actor, cheese.id, { code: '0004082000095' })

    expect(reply.status).toBe(200)
    expect((await codesOf(cheese.id)).map((row) => row.code)).toEqual(['00408295'])
  })

  it('names another item holding the code or its twin with a 409, and writes nothing', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана' })
    const kefir = await add({ name: 'Кефир 1%', barcodes: [KEFIR] })
    const cheese = await add({ name: 'Сыр чечил', barcodes: ['00408295'] })

    const direct = await attach(actor, cream.id, { code: KEFIR })
    const twin = await attach(actor, cream.id, { code: '0004082000095' })

    expect(direct.status).toBe(409)
    expect(barcodeTakenSchema.parse(direct.body).taken.id).toBe(kefir.id)
    expect(barcodeTakenSchema.parse(twin.body).taken.id).toBe(cheese.id)
    expect(await codesOf(cream.id)).toEqual([])
  })

  it('refuses a code whose digit does not hold, and a body of no code shape', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана' })

    const digit = await attach(actor, cream.id, { code: '4850001234563' })
    const shape = await attach(actor, cream.id, { code: '48500' })
    const extra = await attach(actor, cream.id, { code: SOUR_CREAM, itemId: cream.id })

    expect(digit.body).toEqual({ code: ERROR.BARCODE_CHECK_DIGIT })
    expect([digit.status, shape.status, extra.status]).toEqual([400, 400, 400])
    expect(await codesOf(cream.id)).toEqual([])
  })

  it('answers a missing item, a malformed id and nobody signed in as the door answers', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана' })

    const missing = await attach(actor, '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c', { code: MILK })
    const malformed = await attach(actor, 'not-an-id', { code: MILK })
    const nobody = await attach(null, cream.id, { code: MILK })

    expect([missing.status, malformed.status, nobody.status]).toEqual([404, 404, 401])
    expect(await db.select().from(itemBarcodes)).toEqual([])
  })

  it('stops at twenty codes an item: 20 written, the 21st refused (boundary)', async () => {
    const actor = await insertActor(db)
    const bodies = Array.from({ length: 19 }, (_, i) => `4851000000${String(i).padStart(2, '0')}`)
    const withDigit = (body: string) => {
      let sum = 0
      for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
        sum += Number(body[i]) * weight
      }
      return `${body}${String((10 - (sum % 10)) % 10)}`
    }
    const cream = await add({ name: 'Сметана', barcodes: bodies.map(withDigit) })

    const twentieth = await attach(actor, cream.id, { code: SOUR_CREAM })
    const twentyFirst = await attach(actor, cream.id, { code: KEFIR })

    expect(twentieth.status).toBe(201)
    expect(twentyFirst.status).toBe(409)
    expect(twentyFirst.body).toEqual({ code: ERROR.BARCODES_FULL })
    expect(await codesOf(cream.id)).toHaveLength(20)
  })

  it('writes one package to one item when two write it at once through its twins (Р-2)', async () => {
    const actor = await insertActor(db)
    const cheese = await add({ name: 'Сыр чечил' })
    const salad = await add({ name: 'Салат' })
    const other = connectDrizzle()
    const second = buildServer({ db: other.db })
    await second.ready()
    try {
      const cookie = await signIn(db, actor)
      const inject = (server: FastifyInstance, itemId: string, code: string) =>
        server.inject({
          method: 'POST',
          url: `/catalogue/items/${itemId}/barcodes`,
          headers: { cookie },
          payload: { code },
        })
      const replies = await Promise.all([
        inject(app, cheese.id, '00408295'),
        inject(second, salad.id, '0004082000095'),
      ])

      expect(replies.map((reply) => reply.statusCode).sort()).toEqual([201, 409])
      expect(await db.select().from(itemBarcodes)).toHaveLength(1)
    } finally {
      await second.close()
      await other.close()
    }
  })

  it('writes nothing to the event log and no pick', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана' })

    await attach(actor, cream.id, { code: SOUR_CREAM })

    expect(await viewsOf(actor)).toEqual([])
    expect(await db.select().from(searchPicks)).toEqual([])
  })
})

describe('DELETE /catalogue/items/:itemId/barcodes — «не этот товар?» (MOL-100, В-1)', () => {
  it('lets the code go for anyone, and the next scan finds nothing', async () => {
    const author = await insertActor(db)
    const witness = await insertActor(db)
    const kefir = await add({ name: 'Кефир 1%' })
    await attach(author, kefir.id, { code: SOUR_CREAM })

    const reply = await detach(witness, kefir.id, code(SOUR_CREAM))

    expect(reply.statusCode).toBe(204)
    expect(reply.headers['cache-control']).toBe('no-store')
    expect(await codesOf(kefir.id)).toEqual([])
    expect(held(await byCode(witness, code(SOUR_CREAM)))).toBeNull()
  })

  it('lets go of the form the item holds when the code comes as its twin', async () => {
    const actor = await insertActor(db)
    const cheese = await add({ name: 'Сыр чечил', barcodes: ['00408295', MILK] })

    await detach(actor, cheese.id, code('0004082000095'))

    expect((await codesOf(cheese.id)).map((row) => row.code)).toEqual([MILK])
  })

  it('must not let go of a code another item holds', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана' })
    const kefir = await add({ name: 'Кефир 1%', barcodes: [KEFIR] })

    const reply = await detach(actor, cream.id, code(KEFIR))

    expect(reply.statusCode).toBe(204)
    expect((await codesOf(kefir.id)).map((row) => row.code)).toEqual([KEFIR])
  })

  it('answers a missing item with 404, no code with 400, and nobody signed in with 401', async () => {
    const actor = await insertActor(db)
    const cream = await add({ name: 'Сметана', barcodes: [SOUR_CREAM] })

    const missing = await detach(actor, '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c', code(SOUR_CREAM))
    const bare = await detach(actor, cream.id, '')
    const nobody = await detach(null, cream.id, code(SOUR_CREAM))

    expect([missing.statusCode, bare.statusCode, nobody.statusCode]).toEqual([404, 400, 401])
    expect(await codesOf(cream.id)).toHaveLength(1)
  })
})
