import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { DomainError, ERROR } from '@molvia/model'
import { createSessionRepository } from '@/db/sessions-repository'
import { sessions } from '@/db/schema'
import { connectDrizzle } from './db'
import { anHourFromNow, clearAll, insertActor } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createSessionRepository(db)

/** 32 bytes, the way the API will mint one — the length is what makes sha256 the right hash. */
function token(): string {
  return randomBytes(32).toString('base64url')
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('сессия — ключ, и в базе от него только хеш', () => {
  it('не хранит самого токена ни в одной колонке', async () => {
    const actorId = await insertActor(db)
    const secret = token()

    await repository.create(randomUUID(), actorId, secret, 'iPhone · Safari', anHourFromNow())

    const [row] = await db.select().from(sessions)
    // По всей строке, а не по одной колонке: вопрос «не утёк ли токен» — про таблицу целиком,
    // и колонка, добавленная позже, должна попасть под ту же проверку сама собой.
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row?.tokenHash).not.toBe(secret)
  })

  it('находит владельца по токену — и только по живой сессии', async () => {
    const actorId = await insertActor(db)
    const mine = token()
    await repository.create(randomUUID(), actorId, mine, null, anHourFromNow())

    const found = await repository.byToken(mine)

    expect(found?.actorId).toBe(actorId)
    expect(found?.deviceName).toBeNull()
  })

  it('чужой, мусорный и истёкший токен дают один и тот же ничего', async () => {
    // Три ответа, которые обязаны быть неотличимы: MOL-53 отвечает на все 401, и разница
    // между ними — это подсказка, как подбирать. Мусор отдельно: раньше такой путь
    // упирался в Postgres и приходил пятисоткой, то есть третьим различимым ответом.
    const actorId = await insertActor(db)
    const expired = token()
    const expiredId = randomUUID()
    await repository.create(expiredId, actorId, expired, null, anHourFromNow())
    // Стареет строка целиком, как её старит время: `sessions_lifetime_forward` не примет
    // сессию, истёкшую раньше, чем она началась, — и правильно делает.
    await db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      })
      .where(eq(sessions.id, expiredId))

    expect(await repository.byToken(token())).toBeNull()
    expect(await repository.byToken('не токен вовсе')).toBeNull()
    expect(await repository.byToken('')).toBeNull()
    expect(await repository.byToken(expired)).toBeNull()
  })

  it('отозванная сессия не находится, а соседние устройства целы', async () => {
    // Отзыв — удаление строки (Р-4). Проверяется здесь свойство, а не механика: саму ручку
    // «выгнать устройство» даёт MOL-57, а «удалённая не находится» — обещание этой схемы.
    const actorId = await insertActor(db)
    const phone = token()
    const laptop = token()
    const phoneId = randomUUID()
    await repository.create(phoneId, actorId, phone, 'iPhone · Safari', anHourFromNow())
    await repository.create(randomUUID(), actorId, laptop, 'MacBook · Chrome', anHourFromNow())

    await db.delete(sessions).where(eq(sessions.id, phoneId))

    expect(await repository.byToken(phone)).toBeNull()
    expect((await repository.byToken(laptop))?.deviceName).toBe('MacBook · Chrome')
  })

  it('имя устройства, которое нечем показать, становится «без имени», а не отказом', async () => {
    // Имя — украшение: MOL-53 выводит его из `User-Agent`, то есть из строки, которую шлёт кто
    // угодно, и вход не должен падать из-за косметики заголовка. Раньше падал, и хуже: строка
    // оставалась в базе, а вызывающий получал ZodError — пятисотку **вместе** с записью,
    // причём сессию уже было не забрать и не отозвать (адверсариальный проход, А1).
    const actorId = await insertActor(db)
    const first = token()
    const second = token()

    // U+2800 рисует пустоту и не является `\s` — тот самый класс, который CLAUDE.md заводил
    // дважды: Hangul-филлеры в MOL-12, U+13441 в MOL-27.
    await repository.create(randomUUID(), actorId, first, '\u2800\u2800', anHourFromNow())
    await repository.create(randomUUID(), actorId, second, '   ', anHourFromNow())

    expect((await repository.byToken(first))?.deviceName).toBeNull()
    expect((await repository.byToken(second))?.deviceName).toBeNull()
    await expect(db.select().from(sessions)).resolves.toHaveLength(2)
  })

  it('в колонке лежит ровно то, что вернул метод: имя подрезается до записи', async () => {
    // Раньше `visibleLine` подрезал на чтении, а писалось сырое значение — и колонка
    // расходилась с сущностью, что стало бы видно на первом же сравнении в списке устройств
    // (А4). Заодно имя на границе длины с пробелом по краям больше не даёт 22001.
    const actorId = await insertActor(db)
    const padded = token()
    const atTheLimit = token()
    await repository.create(randomUUID(), actorId, padded, '  iPhone · Safari  ', anHourFromNow())
    await repository.create(
      randomUUID(),
      actorId,
      atTheLimit,
      ` ${'a'.repeat(80)} `,
      anHourFromNow(),
    )

    const rows = await db.select().from(sessions)
    expect(rows.map((row) => row.deviceName).sort()).toEqual(['a'.repeat(80), 'iPhone · Safari'])
  })

  it('срок в прошлом — отказ нашей схемы, а не 23514 насквозь, и строки не остаётся', async () => {
    // `sessions_lifetime_forward` говорит то же самое, но кодом, который никто не переводит (А5).
    // Класс проверяется нарочно: `rejects.toThrow()` без него прошёл бы и для старой ошибки
    // Postgres — то есть ровно для того, что этот тест и должен был различать (Р1). ZodError,
    // а не DomainError: срок считает сам сервер из константы, так что назвать этим кодом
    // некого, и в реестре его поэтому нет.
    const actorId = await insertActor(db)

    await expect(
      repository.create(randomUUID(), actorId, token(), null, new Date(Date.now() - 1000)),
    ).rejects.toThrow(ZodError)
    await expect(db.select().from(sessions)).resolves.toHaveLength(0)
  })

  it('имя устройства длиннее предела режется, а не пропадает', async () => {
    // Слишком длинное и «не рисует ничего» — разные вещи, и раньше оба давали `null` (Р5).
    const actorId = await insertActor(db)
    const secret = token()

    await repository.create(
      randomUUID(),
      actorId,
      secret,
      `iPhone · Safari ${'о'.repeat(200)}`,
      anHourFromNow(),
    )

    const name = (await repository.byToken(secret))?.deviceName
    expect(name).toHaveLength(80)
    expect(name?.startsWith('iPhone · Safari')).toBe(true)
  })

  it('секрет обычным base64 принимается — чеканит MOL-53, и не обязательно url-safe', async () => {
    // Узкий алфавит отвергал `=` в хвосте, то есть один `.toString('base64')` в MOL-53
    // сделал бы пятисоткой каждый вход, и ни один здешний тест этого бы не показал (Р4).
    const actorId = await insertActor(db)
    const padded = randomBytes(32).toString('base64')
    expect(padded.endsWith('=')).toBe(true)

    await repository.create(randomUUID(), actorId, padded, null, anHourFromNow())

    expect((await repository.byToken(padded))?.actorId).toBe(actorId)
  })

  it('токен, которого этот сервер не мог выдать, не пишется и ничего не находит', async () => {
    // `sha256Hex` сворачивает одиночный суррогат в U+FFFD, поэтому два разных таких токена
    // делят хеш — и открыли бы одну сессию (А6). Форма проверяется на входе, и тождество
    // «хеш = токен» держится на том алфавите, из которого токены и берутся.
    const actorId = await insertActor(db)

    await expect(
      repository.create(randomUUID(), actorId, '\uD800', null, anHourFromNow()),
    ).rejects.toThrow()
    expect(await repository.byToken('\uD800')).toBeNull()
    expect(await repository.byToken('\uDFFF')).toBeNull()
    expect(await repository.byToken('короткий')).toBeNull()
    await expect(db.select().from(sessions)).resolves.toHaveLength(0)
  })

  it('сессия несуществующего владельца — NOT_FOUND, а не пятисотка', async () => {
    const orphan = repository.create(randomUUID(), randomUUID(), token(), null, anHourFromNow())

    await expect(orphan).rejects.toThrow(DomainError)
    await expect(orphan).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })

  it('два устройства одного человека живут рядом, и это разные ключи', async () => {
    const actorId = await insertActor(db)
    const phone = token()
    const laptop = token()

    await repository.create(randomUUID(), actorId, phone, 'iPhone · Safari', anHourFromNow())
    await repository.create(randomUUID(), actorId, laptop, 'MacBook · Chrome', anHourFromNow())

    expect((await repository.byToken(phone))?.id).not.toBe((await repository.byToken(laptop))?.id)
    await expect(db.select().from(sessions)).resolves.toHaveLength(2)
  })
})
