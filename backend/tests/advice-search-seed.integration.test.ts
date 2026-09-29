/**
 * The search on «Что брать» over the real catalogue (MOL-128, adversarial А): what is rated is not
 * cut by the limit of the search. The seed holds 21 names with the whole word «Сыр» and three that
 * start with it — 24 behind one word for a limit of 20 — and the ranking knows nothing of verdicts,
 * so the cut used to take a rated cheese, its «не брать нигде» included.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { adviceResponseSchema, adviceSearchResponseSchema, toSearchKey } from '@molvia/model'
import type { AdviceResponse, AdviceSearchResponse } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { CATALOGUE_SEED } from '@/catalogue-seed'
import { items, verdicts } from '@/db/schema'
import { SEARCH_LIMIT } from '@/usecases/search-catalogue'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, signIn } from './fixtures'

const { db, close } = connectDrizzle()
let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
  await db.insert(items).values(
    CATALOGUE_SEED.map(([name, unit]) => ({
      id: randomUUID(),
      kind: 'product' as const,
      name,
      searchKey: toSearchKey(name),
      defaultUnit: unit,
    })),
  )
})

afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

async function idOf(name: string): Promise<string> {
  const [row] = await db.select({ id: items.id }).from(items).where(eq(items.name, name))
  if (!row) throw new Error(`${name} is not in the seed`)
  return row.id
}

async function rate(actorId: string, name: string, score: number): Promise<void> {
  await db.insert(verdicts).values({
    id: randomUUID(),
    actorId,
    itemId: await idOf(name),
    itemKind: 'product',
    score,
  })
}

async function search(actorId: string, q: string): Promise<AdviceSearchResponse> {
  const reply = await app.inject({
    method: 'GET',
    url: `/advice/search?${new URLSearchParams({ q }).toString()}`,
    headers: { cookie: await signIn(db, actorId) },
  })
  expect(reply.statusCode).toBe(200)
  return adviceSearchResponseSchema.parse(JSON.parse(reply.body))
}

async function list(actorId: string): Promise<AdviceResponse> {
  const reply = await app.inject({
    method: 'GET',
    url: '/advice',
    headers: { cookie: await signIn(db, actorId) },
  })
  expect(reply.statusCode).toBe(200)
  return adviceResponseSchema.parse(JSON.parse(reply.body))
}

const names = (answer: AdviceSearchResponse) => answer.items.map((found) => found.name)

/** Every seed name with the whole word «Сыр» — what a person reads on a package. */
const CHEESES = CATALOGUE_SEED.map(([name]) => name).filter((name) => /(^|\s)Сыр(\s|$)/u.test(name))

/**
 * A cheese past the first twenty, asked of the server itself with nothing rated — so the test
 * does not depend on how the ranking orders equals today (it was «Сыр маскарпоне» on a570932).
 */
async function victim(): Promise<string> {
  const nobody = await insertActor(db)
  const shown = names(await search(nobody, 'сыр'))
  const cut = CHEESES.find((name) => !shown.includes(name))
  if (!cut) throw new Error('nothing was cut')
  return cut
}

describe('the search on «Что брать» keeps what is rated past its limit (adversarial А)', () => {
  it('a cheese rated 5 past the first twenty is found for «сыр», with its verdict', async () => {
    expect(CHEESES.length).toBeGreaterThan(SEARCH_LIMIT)
    const cheese = await victim()
    const me = await insertActor(db)
    await rate(me, cheese, 5)

    const answer = await search(me, 'сыр')

    expect(answer.items.slice(0, SEARCH_LIMIT).map((found) => found.name)).not.toContain(cheese)
    expect(answer.items.find((found) => found.name === cheese)?.advice?.level).toBe('take')
    expect(answer.near).toBe(true)
  })

  it('one’s own «не брать нигде» is found, transliterated too', async () => {
    const cheese = await victim()
    const me = await insertActor(db)
    await rate(me, cheese, 1)

    const answer = await search(me, 'syr')
    expect(
      answer.items.filter((found) => found.advice?.level === 'never').map((f) => f.name),
    ).toEqual([cheese])
  })

  it('every cheese rated — all of them answered, the one five among them', async () => {
    const best = await victim()
    const me = await insertActor(db)
    for (const name of CHEESES) await rate(me, name, name === best ? 5 : 3)

    const answer = await search(me, 'сыр')

    expect(answer.items.filter((found) => found.advice !== null)).toHaveLength(CHEESES.length)
    expect(answer.items.find((found) => found.name === best)?.advice?.level).toBe('take')
  })

  it('must not fire: what is not rated past the limit stays out — twenty and no more', async () => {
    const nobody = await insertActor(db)
    const answer = await search(nobody, 'сыр')
    expect(answer.items).toHaveLength(SEARCH_LIMIT)
    expect(answer.items.every((found) => found.advice === null)).toBe(true)
  })

  it('the word of its own finds it as before', async () => {
    const cheese = await victim()
    const me = await insertActor(db)
    await rate(me, cheese, 5)

    const own = cheese.split(' ').at(-1) ?? ''
    const answer = await search(me, own)
    expect(answer.items.find((found) => found.name === cheese)?.advice?.level).toBe('take')
  })

  it('«молоко» — fewer names than the limit — keeps the rated one', async () => {
    const me = await insertActor(db)
    const milks = CATALOGUE_SEED.map(([name]) => name).filter((name) =>
      toSearchKey(name).split(' ').includes('moloko'),
    )
    expect(milks.length).toBeLessThan(SEARCH_LIMIT)
    const longest = [...milks].sort((a, b) => b.length - a.length)[0] ?? ''
    await rate(me, longest, 5)

    const answer = await search(me, 'молоко')
    expect(answer.items.find((found) => found.name === longest)?.advice?.level).toBe('take')
  })

  it('the list still has it — the search and the list agree', async () => {
    const cheese = await victim()
    const me = await insertActor(db)
    await rate(me, cheese, 5)
    expect((await list(me)).rows.map((row) => [row.name, row.level])).toEqual([[cheese, 'take']])
  })
})
