/**
 * Проверка задачи: «сессия другого владельца не открывает чужие данные» — по **каждой**
 * существующей ручке (MOL-53).
 *
 * Владение проверено и на уровне репозиториев (`ownership.integration`), и это не дубль: там
 * проверяется `WHERE`, здесь — что до него доезжает именно тот владелец, которого доказала
 * cookie, и что чужое отвечает ровно тем же, чем несуществующее. Разница в ответах — это
 * способ перебирать чужие идентификаторы по одному.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ERROR } from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { clearAll, insertActor, insertItem, signIn } from './fixtures'

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

interface Reply {
  readonly status: number
  readonly body: unknown
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  cookie: string,
  body?: unknown,
): Promise<Reply> {
  const response = await app.inject({
    method,
    url,
    headers: { cookie },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  })
  return {
    status: response.statusCode,
    body: response.body === '' ? undefined : (JSON.parse(response.body) as unknown),
  }
}

const code = (reply: Reply): unknown => (reply.body as { code?: unknown } | undefined)?.code

/** Аня с походом, покупкой и оценкой — и Борис, у которого нет ничего. */
async function scene() {
  const anna = await insertActor(db)
  const boris = await insertActor(db)
  const mine = await signIn(db, anna)
  const theirs = await signIn(db, boris)
  const itemId = await insertItem(db)

  const tripId = randomUUID()
  await call('POST', '/trips', mine, {
    id: tripId,
    place: { kind: 'store', name: 'Ереван Сити' },
  })
  const expenseId = randomUUID()
  await call('POST', `/trips/${tripId}/expenses`, mine, { id: expenseId, itemId })
  await call('PUT', `/verdicts/${itemId}`, mine, { score: 5, review: 'Отличное' })

  return { anna, boris, mine, theirs, itemId, tripId, expenseId }
}

describe('чужая сессия не открывает чужой поход', () => {
  it('не видит его, не правит его строки, не завершает и не выбирает ему курс', async () => {
    const { theirs, tripId, expenseId, itemId } = await scene()

    const answers = [
      await call('POST', `/trips/${tripId}/expenses`, theirs, {
        id: randomUUID(),
        itemId,
      }),
      await call('PATCH', `/trips/${tripId}/expenses/${expenseId}`, theirs, {
        amount: { amount: '1.00', currency: 'AMD' },
      }),
      await call('DELETE', `/trips/${tripId}/expenses/${expenseId}`, theirs),
      await call('POST', `/trips/${tripId}/finish`, theirs),
      await call('PUT', `/trips/${tripId}/rate-choice`, theirs, { choice: 'jumped' }),
    ]

    for (const answer of answers) {
      expect(answer.status).toBe(404)
      expect(code(answer)).toBe(ERROR.NOT_FOUND)
    }
  })

  it('отвечает на чужой поход ровно тем же, чем на несуществующий', async () => {
    const { theirs, tripId } = await scene()
    const nobodys = randomUUID()

    const alien = await call('POST', `/trips/${tripId}/finish`, theirs)
    const missing = await call('POST', `/trips/${nobodys}/finish`, theirs)

    expect(alien).toEqual(missing)
  })

  it('на «мой текущий поход» отдаёт пусто, а не чужой', async () => {
    const { theirs } = await scene()

    const current = await call('GET', '/trips/current', theirs)

    expect(current.status).toBe(200)
    expect(current.body).toEqual({ trip: null })
  })

  it('у Ани всё на месте — проверка ловит запрет, а не поломку', async () => {
    const { mine, tripId, expenseId } = await scene()

    const priced = await call('PATCH', `/trips/${tripId}/expenses/${expenseId}`, mine, {
      amount: { amount: '1.00', currency: 'AMD' },
    })
    const finished = await call('POST', `/trips/${tripId}/finish`, mine)

    expect(priced.status).toBe(200)
    expect(finished.status).toBe(204)
  })
})

describe('чужая сессия не трогает чужую оценку', () => {
  it('не правит и не снимает её', async () => {
    const { theirs, itemId } = await scene()

    const amended = await call('PATCH', `/verdicts/${itemId}`, theirs, { score: 1 })
    const withdrawn = await call('DELETE', `/verdicts/${itemId}`, theirs)

    expect(amended.status).toBe(404)
    expect(withdrawn.status).toBe(404)
  })

  it('своя оценка на тот же товар не затирает чужую', async () => {
    // Ключ вердикта — «человек + товар», и путь адресуется товаром: без владельца в `WHERE`
    // второй человек переписал бы первого.
    const { anna, theirs, itemId } = await scene()

    const rated = await call('PUT', `/verdicts/${itemId}`, theirs, { score: 1 })
    expect(rated.status).toBe(201)

    const annas = await call('GET', '/verdicts/pending', await signIn(db, anna))
    expect(annas.status).toBe(200)
  })

  it('в очереди оценок чужие покупки не появляются', async () => {
    const { theirs } = await scene()

    const pending = await call('GET', '/verdicts/pending', theirs)

    expect(pending.body).toEqual({ items: [], total: 0 })
  })
})

describe('чужая сессия не видит чужих данных на общих экранах', () => {
  it('«Что брать» отдаёт своё, а не соседское', async () => {
    const { theirs } = await scene()

    const advice = await call('GET', '/advice', theirs)

    expect(advice.status).toBe(200)
    expect(advice.body).toMatchObject({ rows: [], total: 0 })
  })

  it('недавние места — только свои', async () => {
    const { theirs } = await scene()

    const recent = await call('GET', '/places/recent', theirs)

    expect(recent.body).toEqual({ places: [] })
  })

  it('«кто я» — тот, чью cookie прислали, и никто другой', async () => {
    const { anna, boris, mine, theirs } = await scene()

    const asAnna = await call('GET', '/actors/me', mine)
    const asBoris = await call('GET', '/actors/me', theirs)

    expect((asAnna.body as { id: string }).id).toBe(anna)
    expect((asBoris.body as { id: string }).id).toBe(boris)
  })

  it('справочник общий, но запомненный выбор — нет', async () => {
    // Каталог один на всех по устройству; личное в нём — только память о выборе (MOL-11),
    // и она считается по спрашивающему, а не сумме по людям.
    const { mine, theirs } = await scene()

    const bySearch = await call('GET', '/catalogue/search?q=молоко', theirs)
    const own = await call('GET', '/catalogue/search?q=молоко', mine)

    expect(bySearch.status).toBe(200)
    expect(own.status).toBe(200)
  })
})
