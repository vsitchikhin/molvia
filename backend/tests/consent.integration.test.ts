import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POLICY_VERSION } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { createActorRepository } from '@/db/actors-repository'
import { actors } from '@/db/schema'
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
})
afterAll(async () => {
  await app.close()
  await clearAll(db)
  await close()
})

async function signedIn(): Promise<{ id: string; cookie: string }> {
  const id = await insertActor(db)
  return { id, cookie: await signIn(db, id) }
}

async function read(cookie: string) {
  return app.inject({ method: 'GET', url: '/actors/me/consent', headers: { cookie } })
}

async function accept(cookie: string, payload: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/actors/me/consent',
    headers: { cookie },
    payload: payload as Record<string, unknown>,
  })
}

async function row(id: string) {
  const [found] = await db
    .select({ version: actors.consentVersion, at: actors.consentedAt })
    .from(actors)
    .where(eq(actors.id, id))
  return found
}

describe('согласие с условиями и политикой (MOL-95)', () => {
  it('у владельца без согласия — пусто: так у всех, кто был до миграции', async () => {
    const { id, cookie } = await signedIn()
    const response = await read(cookie)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ version: null })
    expect(await row(id)).toEqual({ version: null, at: null })
  })

  it('принятие записывает редакцию и момент сервера', async () => {
    const { id, cookie } = await signedIn()
    const before = new Date()
    const response = await accept(cookie, { version: POLICY_VERSION })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toEqual({ version: POLICY_VERSION })
    expect((await read(cookie)).json()).toEqual({ version: POLICY_VERSION })
    const stored = await row(id)
    expect(stored?.version).toBe(POLICY_VERSION)
    // The database's clock and the test's are one machine's; a second either way is the margin.
    expect(stored?.at?.getTime()).toBeGreaterThan(before.getTime() - 1000)
  })

  it('повтор той же редакции — тот же ответ, и момент первого принятия не двигается', async () => {
    const { id, cookie } = await signedIn()
    await accept(cookie, { version: POLICY_VERSION })
    const first = await row(id)
    const again = await accept(cookie, { version: POLICY_VERSION })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual({ version: POLICY_VERSION })
    expect(await row(id)).toEqual(first)
  })

  it('сборка редакции 1 после выкатки редакции 2 (MOL-236): её «Принимаю» берётся, принятое не опускается', async () => {
    const { id, cookie } = await signedIn()
    const old = await accept(cookie, { version: 1 })
    expect(old.statusCode).toBe(200)
    expect(old.json()).toEqual({ version: 1 })
    expect((await accept(cookie, { version: 2 })).json()).toEqual({ version: 2 })
    const accepted = await row(id)
    // A phone not yet updated sends its own edition again: the answer names the newer one.
    expect((await accept(cookie, { version: 1 })).json()).toEqual({ version: 2 })
    expect(await row(id)).toEqual(accepted)
  })

  it('два окна принимают разом — одна запись, оба слышат ту же редакцию', async () => {
    const { id, cookie } = await signedIn()
    const answers = await Promise.all([
      accept(cookie, { version: POLICY_VERSION }),
      accept(cookie, { version: POLICY_VERSION }),
    ])
    for (const answer of answers) expect(answer.json()).toEqual({ version: POLICY_VERSION })
    expect((await row(id))?.version).toBe(POLICY_VERSION)
  })

  it('границы: 0, редакция, которой ещё нет, дробь, строка, пустое тело и момент в теле — 400', async () => {
    const { id, cookie } = await signedIn()
    for (const payload of [
      { version: 0 },
      { version: POLICY_VERSION + 1 },
      { version: 1.5 },
      { version: '1' },
      {},
      { version: POLICY_VERSION, consentedAt: '2020-01-01T00:00:00Z' },
    ]) {
      expect((await accept(cookie, payload)).statusCode, JSON.stringify(payload)).toBe(400)
    }
    expect(await row(id)).toEqual({ version: null, at: null })
  })

  it('у каждого своё: чужое согласие не видно и не трогается', async () => {
    const me = await signedIn()
    const other = await signedIn()
    await accept(me.cookie, { version: POLICY_VERSION })
    expect((await read(other.cookie)).json()).toEqual({ version: null })
    expect(await row(other.id)).toEqual({ version: null, at: null })
  })

  it('без сессии — 401 на обеих ручках', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      const response = await app.inject({
        method,
        url: '/actors/me/consent',
        ...(method === 'PUT' ? { payload: { version: POLICY_VERSION } } : {}),
      })
      expect(response.statusCode, method).toBe(401)
    }
  })

  it('/actors/me согласия не несёт: установленное приложение читает его строго', async () => {
    const { cookie } = await signedIn()
    await accept(cookie, { version: POLICY_VERSION })
    const me = await app.inject({ method: 'GET', url: '/actors/me', headers: { cookie } })
    expect(Object.keys(me.json())).not.toContain('consentVersion')
    expect(Object.keys(me.json())).not.toContain('version')
  })
})

describe('репозиторий: согласие только растёт (MOL-95, Р-3)', () => {
  it('младшая редакция — от сборки, которая не обновилась, — ничего не меняет', async () => {
    const id = await insertActor(db)
    const repository = createActorRepository(db)
    expect(await repository.acceptConsent(id, 2)).toBe(2)
    const accepted = await row(id)
    expect(await repository.acceptConsent(id, 1)).toBe(2)
    expect(await row(id)).toEqual(accepted)
  })

  it('старшая перезаписывает редакцию и момент', async () => {
    const id = await insertActor(db)
    const repository = createActorRepository(db)
    await repository.acceptConsent(id, 1)
    await db
      .update(actors)
      .set({ consentedAt: new Date('2026-01-01T00:00:00Z') })
      .where(eq(actors.id, id))
    expect(await repository.acceptConsent(id, 2)).toBe(2)
    const stored = await row(id)
    expect(stored?.version).toBe(2)
    expect(stored?.at?.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime())
  })

  it('чужой или кривой id — ничего, без ошибки', async () => {
    const repository = createActorRepository(db)
    expect(await repository.consentVersion('not-a-uuid')).toBeNull()
    expect(await repository.acceptConsent('not-a-uuid', 1)).toBeNull()
    expect(await repository.acceptConsent('00000000-0000-4000-8000-000000000000', 1)).toBeNull()
  })

  it('база не держит половину согласия: редакция без момента и момент без редакции', async () => {
    const id = await insertActor(db)
    await expect(
      db.execute(sql`update actors set consent_version = 1 where id = ${id}`),
    ).rejects.toThrow()
    await expect(
      db.execute(sql`update actors set consented_at = now() where id = ${id}`),
    ).rejects.toThrow()
    await expect(
      db.execute(sql`update actors set consent_version = 0, consented_at = now() where id = ${id}`),
    ).rejects.toThrow()
  })
})
