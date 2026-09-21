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
  catalogueEntryCodec,
  catalogueSearchResponseSchema,
} from '@molvia/model'
import type { CatalogueEntry, NewItem } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { events, items } from '@/db/schema'
import { createItemRepository } from '@/db/items-repository'
import { createSearchPickRepository } from '@/db/search-picks-repository'
import { SEARCH_LIMIT } from '@/usecases/search-catalogue'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createItemRepository(db)
const picks = createSearchPickRepository(db)

const UNKNOWN_ID = '11111111-1111-4111-8111-111111111111'

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
    headers: actor === null ? {} : { 'x-molvia-actor': actor },
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
    headers: actor === null ? {} : { 'x-molvia-actor': actor },
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

    const missing = await search(null, q('молоко'))
    const malformed = await search('not-a-uuid', q('молоко'))
    const unknown = await search(UNKNOWN_ID, q('молоко'))

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
      headers: { 'x-molvia-actor': actor },
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
    const direct = await repository.search('молоко', SEARCH_LIMIT, actor)

    expect(ids(found(reply))).toEqual(ids(direct))
    expect(found(reply).length).toBeGreaterThan(0)
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
      const inject = (server: FastifyInstance) =>
        server.inject({
          method: 'POST',
          url: '/catalogue/items',
          headers: { 'x-molvia-actor': actor },
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

  it('refuses a dish until 0.3 and a barcode until 0.2, and writes nothing', async () => {
    // A dish would enter the log as a product forever; a barcode beside a known name would be
    // dropped in silence or turn a 409 into a 200. Both wait for the release that needs them.
    const actor = await insertActor(db)

    const dish = await propose(actor, { ...cheese, kind: 'dish', defaultUnit: 'piece' })
    const barcoded = await propose(actor, { ...cheese, barcodes: ['4850001234567'] })

    expect(dish.status).toBe(400)
    expect(dish.body).toMatchObject({ code: ISSUE.BODY_INVALID, details: 'kind' })
    expect(barcoded.status).toBe(400)
    expect(barcoded.body).toEqual({ code: ISSUE.BODY_INVALID, details: 'barcodes' })
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
