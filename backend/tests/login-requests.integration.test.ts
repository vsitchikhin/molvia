import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DomainError, ERROR } from '@molvia/model'
import { createLoginRequestRepository } from '@/db/login-requests-repository'
import { loginRequests } from '@/db/schema'
import { connectDrizzle } from './db'
import { anHourFromNow, clearAll } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createLoginRequestRepository(db)

const TELEGRAM_ID = 777_000_123

function secret(): string {
  return randomBytes(32).toString('base64url')
}

function code(): string {
  return randomBytes(32).toString('base64url')
}

/** Как это заводит API: свой uuid для опроса, отдельный код для ссылки в бота. */
async function asked(deviceName: string | null = 'iPhone · Safari') {
  const id = randomUUID()
  const theCode = code()
  const theSecret = secret()
  await repository.create(id, theCode, theSecret, deviceName, anHourFromNow())
  return { id, code: theCode, secret: theSecret }
}

/**
 * Состарить строку так, как её старит время: назад уезжает и рождение, и срок. Двигать
 * один `expires_at` нельзя — `login_requests_lifetime_forward` такую строку не примет, и это
 * правильно: запрос, истёкший раньше, чем был заведён, не бывает.
 */
async function expire(id: string): Promise<void> {
  await db
    .update(loginRequests)
    .set({
      createdAt: new Date(Date.now() - 7_200_000),
      expiresAt: new Date(Date.now() - 3_600_000),
    })
    .where(eq(loginRequests.id, id))
}

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await close()
})

describe('запрос входа: секрет только хешем', () => {
  it('не хранит самого секрета ни в одной колонке', async () => {
    const request = await asked()

    const [row] = await db.select().from(loginRequests)
    expect(JSON.stringify(row)).not.toContain(request.secret)
    expect(row?.secretHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('два запроса на один код — конфликт, а не вторая дверь под тем же адресом', async () => {
    const shared = code()
    await repository.create(randomUUID(), shared, secret(), null, anHourFromNow())

    const twin = repository.create(randomUUID(), shared, secret(), null, anHourFromNow())
    await expect(twin).rejects.toThrow(DomainError)
    await expect(twin).rejects.toMatchObject({ code: ERROR.CONFLICT })
  })
})

describe('истёкший, использованный и несуществующий — один и тот же ничего', () => {
  it('сходятся в null все пять путей, а не три ветки, которые кто-то держит в согласии', async () => {
    // Ради этого у всех чтений один `WHERE`. Пять случаев: нет такого, истёк, погашен входом,
    // погашен отказом «это не я», и верный id с чужим секретом.
    const missing = await repository.byIdAndSecret(randomUUID(), secret())

    const stale = await asked()
    await expire(stale.id)

    const spent = await asked()
    await repository.confirm(spent.code, TELEGRAM_ID)
    await repository.consume(spent.id, spent.secret)

    const refused = await asked()
    await repository.decline(refused.code)

    const other = await asked()

    expect(missing).toBeNull()
    expect(await repository.byIdAndSecret(stale.id, stale.secret)).toBeNull()
    expect(await repository.byIdAndSecret(spent.id, spent.secret)).toBeNull()
    expect(await repository.byIdAndSecret(refused.id, refused.secret)).toBeNull()
    expect(await repository.byIdAndSecret(other.id, secret())).toBeNull()
  })

  it('мусорный идентификатор — тоже ничего, а не ошибка Postgres', async () => {
    // `22P02` уходил наверх пятисоткой: третий различимый ответ там, где должен быть один.
    expect(await repository.byIdAndSecret('не-uuid', secret())).toBeNull()
    expect(await repository.consume('', secret())).toBeNull()
  })

  it('и мусорный код — тоже: NUL в коде давал 22021, то есть шестой путь', async () => {
    // У `code` не было стража, который есть у `id`, хотя код приходит снаружи — это полезная
    // нагрузка `/start` у бота, и MOL-55 будет читать по нему на каждое «ссылка уже
    // использована» (адверсариальный проход, А3).
    for (const junk of ['\u0000', 'код с пробелом', 'a+b', 'a'.repeat(65), '']) {
      expect(await repository.byCode(junk)).toBeNull()
      expect(await repository.confirm(junk, TELEGRAM_ID)).toBeNull()
      expect(await repository.decline(junk)).toBeNull()
    }
  })

  it('секрет не той формы ничего не открывает и не пишется', async () => {
    // Иначе два разных одиночных суррогата делят хеш и открывают один запрос (А6).
    const request = await asked()
    await repository.confirm(request.code, TELEGRAM_ID)

    expect(await repository.byIdAndSecret(request.id, '\uD800')).toBeNull()
    expect(await repository.consume(request.id, 'короткий')).toBeNull()
    await expect(
      repository.create(randomUUID(), code(), '\uD800', null, anHourFromNow()),
    ).rejects.toThrow()
  })

  it('бот не видит ни истёкшего, ни уже подтверждённого кода', async () => {
    const stale = await asked()
    await expire(stale.id)
    const confirmed = await asked()
    await repository.confirm(confirmed.code, TELEGRAM_ID)

    expect(await repository.byCode(stale.code)).toBeNull()
    expect(await repository.byCode(confirmed.code)).toBeNull()
    expect(await repository.byCode('никогда-не-существовавший')).toBeNull()
  })
})

describe('вход судится до записи, а не после', () => {
  it('код, который база отвергнет, не пишется и приходит доменным отказом', async () => {
    // Раньше это был непереведённый `22001`/`23514` — пятисотка за то, что рядом лежит схема,
    // которой значение проверяется (А5). Теперь отказ один и тот же, и строки не остаётся.
    for (const bad of ['a'.repeat(65), 'код!', 'a+b', '']) {
      await expect(
        repository.create(randomUUID(), bad, secret(), null, anHourFromNow()),
      ).rejects.toThrow()
    }

    await expect(db.select().from(loginRequests)).resolves.toHaveLength(0)
  })

  it('срок в прошлом — отказ домена, и строки тоже не остаётся', async () => {
    await expect(
      repository.create(randomUUID(), code(), secret(), null, new Date(Date.now() - 1000)),
    ).rejects.toThrow()

    await expect(db.select().from(loginRequests)).resolves.toHaveLength(0)
  })

  it('имя устройства, которое нечем показать, становится «без имени»', async () => {
    const request = await asked('\u2800\u2800')

    expect((await repository.byCode(request.code))?.deviceName).toBeNull()
  })

  it('имя подрезается до записи, а не на чтении', async () => {
    const request = await asked('  iPhone · Safari  ')

    const [row] = await db.select().from(loginRequests)
    expect(row?.deviceName).toBe('iPhone · Safari')
    expect((await repository.byCode(request.code))?.deviceName).toBe('iPhone · Safari')
  })

  it('Telegram-id вне границ — отказ домена, а не 23514 насквозь', async () => {
    const request = await asked()

    for (const bad of [0, -1, 1.5, 9_007_199_254_740_992]) {
      await expect(repository.confirm(request.code, bad)).rejects.toThrow()
    }

    // И запрос при этом цел: отказ не тронул строку.
    expect((await repository.byCode(request.code))?.telegramUserId).toBeNull()
  })
})

describe('кнопку в боте нажали', () => {
  it('подтверждение называет аккаунт, и только его', async () => {
    const request = await asked()

    const confirmed = await repository.confirm(request.code, TELEGRAM_ID)

    expect(confirmed?.telegramUserId).toBe(TELEGRAM_ID)
    expect(confirmed?.consumedAt).toBeNull()
    expect(confirmed?.deviceName).toBe('iPhone · Safari')
  })

  it('нажатая повторно, не выдаёт второго входа и не переписывает аккаунт', async () => {
    // «Кнопка, нажатая повторно, не выдаёт второй вход» (MOL-55) — здесь на уровне строки:
    // второй раз подтверждать нечего, и чужой Telegram-id не встанет на место первого.
    const request = await asked()
    await repository.confirm(request.code, TELEGRAM_ID)

    expect(await repository.confirm(request.code, 424_242_424)).toBeNull()

    const [row] = await db.select().from(loginRequests)
    expect(row?.telegramUserId).toBe(TELEGRAM_ID)
  })

  it('«это не я» гасит запрос, и подтвердить его уже нельзя', async () => {
    const request = await asked()

    expect(await repository.decline(request.code)).not.toBeNull()

    expect(await repository.confirm(request.code, TELEGRAM_ID)).toBeNull()
    expect(await repository.decline(request.code)).toBeNull()
  })

  it('отказ после подтверждения не воскрешает ничего: сессию уже не забрать', async () => {
    const request = await asked()
    await repository.confirm(request.code, TELEGRAM_ID)

    await repository.decline(request.code)

    expect(await repository.consume(request.id, request.secret)).toBeNull()
  })
})

describe('сессию забирают ровно один раз', () => {
  it('второй опрос того же браузера не получает ничего', async () => {
    const request = await asked()
    await repository.confirm(request.code, TELEGRAM_ID)

    const first = await repository.consume(request.id, request.secret)
    const second = await repository.consume(request.id, request.secret)

    expect(first?.telegramUserId).toBe(TELEGRAM_ID)
    expect(second).toBeNull()
  })

  it('два окна, опрашивающие разом, уносят строку в одни руки', async () => {
    // Проверка и запись — один оператор, поэтому гонка решается в базе. Врозь оба окна
    // прочли бы неподтверждённый consumed_at и каждое завело бы свою сессию.
    const request = await asked()
    await repository.confirm(request.code, TELEGRAM_ID)

    const both = await Promise.all([
      repository.consume(request.id, request.secret),
      repository.consume(request.id, request.secret),
    ])

    expect(both.filter((one) => one !== null)).toHaveLength(1)
  })

  it('пока человек ещё в боте, опрос не гасит запрос', async () => {
    // Браузер опрашивает, пока экран открыт. Если бы `consume` гасил неподтверждённый запрос,
    // первый же опрос убивал бы вход, который человек как раз собирался подтвердить.
    const request = await asked()

    expect(await repository.consume(request.id, request.secret)).toBeNull()

    expect(await repository.confirm(request.code, TELEGRAM_ID)).not.toBeNull()
    expect(await repository.consume(request.id, request.secret)).not.toBeNull()
  })

  it('чужой секрет не уносит подтверждённый вход', async () => {
    // Ради этого секрет вообще есть: код из ссылки не тайна, и без секрета вход забрал бы
    // любой, кто его увидел.
    const request = await asked()
    await repository.confirm(request.code, TELEGRAM_ID)

    expect(await repository.consume(request.id, secret())).toBeNull()
    expect(await repository.consume(request.id, request.secret)).not.toBeNull()
  })

  it('запрос без имени устройства — обычный запрос', async () => {
    const request = await asked(null)

    expect((await repository.byCode(request.code))?.deviceName).toBeNull()
  })
})
