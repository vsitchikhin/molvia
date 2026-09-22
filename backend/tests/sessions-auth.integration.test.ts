/**
 * Чем запрос доказывает личность, через живой сервер: cookie, четыре неразличимых отказа,
 * границы скользящего срока и правило «ответ с `Set-Cookie` не кешируется» (MOL-53).
 *
 * Репозиторий эти же свойства проверяет у себя (`sessions.integration`), и это не дубль: там
 * проверяется `WHERE`, здесь — то, что до него доезжает заголовок и что уезжает обратно.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  ERROR,
  SESSION_COOKIE,
  SESSION_LIFETIME_DAYS,
  SESSION_TOUCH_AFTER_HOURS,
} from '@molvia/model'
import type { FastifyInstance } from 'fastify'
import { actors, sessions } from '@/db/schema'
import { createActorRepository } from '@/db/actors-repository'
import { createSessionRepository } from '@/db/sessions-repository'
import { signIn } from '@/usecases/sign-in'
import { DEV_ACCOUNT_COOKIE } from '@/cookie'
import { buildServer } from '@/server'
import { connectDrizzle } from './db'
import { aStrangersCookie, anHourFromNow, clearAll, insertActor, telegramId } from './fixtures'

const { db, close } = connectDrizzle()
const repository = createSessionRepository(db)

let app: FastifyInstance

beforeAll(async () => {
  app = buildServer({ db })
  await app.ready()
})

beforeEach(async () => {
  await clearAll(db)
})

afterAll(async () => {
  await clearAll(db)
  await app.close()
  await close()
})

const HOUR = 3_600_000

/**
 * The code of a file with its comments taken out — prose that merely *names* `Set-Cookie` is
 * not a second place that sets one, and the guard below must not mistake the two. Crude on
 * purpose: it is looking for a header name, so a `//` swallowed inside a string costs nothing.
 */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*/g, ' ')
}

/** Every `.ts` under a directory, however deep — the guard below must not miss a new folder. */
function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return walk(path)
    return entry.name.endsWith('.ts') ? [path] : []
  })
}

function aToken(): string {
  return randomBytes(32).toString('base64url')
}

/** «Кто я» с тем заголовком `Cookie`, который дали, — или вовсе без него. */
async function whoAmI(cookie?: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/actors/me',
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  })
  return {
    status: response.statusCode,
    raw: response.body,
    headers: response.headers,
  }
}

/** Владелец с сессией, о которой известно, когда ею пользовались в последний раз. */
async function signedIn(lastSeenHoursAgo = 0) {
  const actorId = await insertActor(db)
  const token = aToken()
  const id = randomUUID()
  await repository.create(id, actorId, token, null, anHourFromNow())
  if (lastSeenHoursAgo > 0) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - lastSeenHoursAgo * HOUR) })
      .where(eq(sessions.id, id))
  }
  return { actorId, id, cookie: `${SESSION_COOKIE}=${token}` }
}

describe('четыре отказа — один ответ', () => {
  it('нет cookie, чужая, отозванная и истёкшая отвечают байт в байт одинаково', async () => {
    const { id, cookie } = await signedIn()
    // Отозванная: отзыв — это удаление строки (Р-4 MOL-52), поэтому её и не отличить.
    await db.delete(sessions).where(eq(sessions.id, id))

    const expired = await signedIn()
    await db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 2 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
      })
      .where(eq(sessions.id, expired.id))

    const answers = [
      await whoAmI(),
      await whoAmI(aStrangersCookie()),
      await whoAmI(cookie),
      await whoAmI(expired.cookie),
    ]

    expect(answers[0]?.status).toBe(401)
    expect(JSON.parse(answers[0]?.raw ?? '')).toEqual({ code: ERROR.NO_ACTOR })
    expect(new Set(answers.map((answer) => answer.status)).size).toBe(1)
    expect(new Set(answers.map((answer) => answer.raw)).size).toBe(1)
    expect(new Set(answers.map((answer) => answer.headers['www-authenticate'])).size).toBe(1)
  })

  it('отвечает тем же на всё, чего этот сервер не мог выпустить', async () => {
    // Негодная форма отсекается до Postgres: иначе `22P02` пришёл бы пятисоткой, то есть
    // третьим различимым ответом там, где их должно быть ровно два — «да» и «нет».
    const nonsense = [
      `${SESSION_COOKIE}=`,
      `${SESSION_COOKIE}=abc`,
      `${SESSION_COOKIE}=${'ы'.repeat(50)}`,
      `${SESSION_COOKIE}=${randomUUID()}`,
      `${SESSION_COOKIE}="${aToken()}"`,
      `${SESSION_COOKIE}_x=${aToken()}`,
      `${SESSION_COOKIE.toUpperCase()}=${aToken()}`,
      'nonsense',
      'x'.repeat(10_000),
    ]

    const answers = await Promise.all(nonsense.map((cookie) => whoAmI(cookie)))

    expect(answers.every((answer) => answer.status === 401)).toBe(true)
    expect(new Set(answers.map((answer) => answer.raw)).size).toBe(1)
  })

  it('гасит присланную cookie, и только присланную', async () => {
    // Мёртвый секрет перестаёт ездить в каждом запросе и лежать на диске (Р-4, В-5). Гасить
    // нечего, когда её не присылали, — и лишний `Set-Cookie` на каждом чужом запросе был бы
    // лишней причиной не кешировать ответ.
    const refused = await whoAmI(aStrangersCookie())
    const bare = await whoAmI()

    expect(String(refused.headers['set-cookie'])).toContain('Max-Age=0')
    expect(String(refused.headers['set-cookie'])).toContain('HttpOnly')
    expect(refused.headers['cache-control']).toBe('no-store')
    expect(bare.headers['set-cookie']).toBeUndefined()
  })

  it('живую сессию не гасит и cookie зря не переставляет', async () => {
    const { cookie } = await signedIn()

    const mine = await whoAmI(cookie)

    expect(mine.status).toBe(200)
    expect(mine.headers['set-cookie']).toBeUndefined()
  })
})

describe('скользящий срок через сервер', () => {
  it('продлевает и переставляет cookie, когда сутки прошли', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)

    const mine = await whoAmI(cookie)

    const set = String(mine.headers['set-cookie'])
    expect(mine.status).toBe(200)
    expect(set).toContain(`${SESSION_COOKIE}=${cookie.split('=')[1] ?? ''}`)
    expect(set).toContain('HttpOnly')
    // Браузер выбросил бы cookie на 180-й день от выдачи, сколько бы человек ни ходил, — а в
    // базе сессия была бы живой. Поэтому срок в cookie движется вместе со строкой.
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)?.[1] ?? '0')
    expect(maxAge).toBeGreaterThan((SESSION_LIFETIME_DAYS - 1) * 24 * 3600)
    // Ответ, который выставляет cookie, не кешируется — на любой ручке (Р-6).
    expect(mine.headers['cache-control']).toBe('no-store')

    const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - HOUR)
  })

  it('на границе суток минус секунда не пишет ничего', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS - 1)
    const [before] = await db.select().from(sessions).where(eq(sessions.id, id))

    const mine = await whoAmI(cookie)

    const [after] = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(mine.headers['set-cookie']).toBeUndefined()
    expect(after?.lastSeenAt).toEqual(before?.lastSeenAt)
    expect(after?.expiresAt).toEqual(before?.expiresAt)
  })

  it('два запроса подряд в те же сутки продлевают один раз', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)

    const first = await whoAmI(cookie)
    const second = await whoAmI(cookie)

    expect(first.headers['set-cookie']).toBeDefined()
    // Второй уже не «засиделся»: строка только что сдвинулась, и `UPDATE` не отправляется.
    expect(second.headers['set-cookie']).toBeUndefined()
    const [row] = await db.select().from(sessions).where(eq(sessions.id, id))
    expect(row?.lastSeenAt.getTime()).toBeGreaterThan(Date.now() - HOUR)
  })

  it('не воскрешает истёкшую и не выдаёт ей cookie', async () => {
    const { id, cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)
    await db
      .update(sessions)
      .set({
        createdAt: new Date(Date.now() - 2 * HOUR),
        expiresAt: new Date(Date.now() - HOUR),
      })
      .where(eq(sessions.id, id))

    const mine = await whoAmI(cookie)

    expect(mine.status).toBe(401)
    expect(String(mine.headers['set-cookie'])).toContain('Max-Age=0')
  })
})

describe('две сессии одного человека', () => {
  it('открывают одни и те же данные, и одна не мешает другой', async () => {
    const actorId = await insertActor(db)
    const phone = aToken()
    const laptop = aToken()
    const phoneId = randomUUID()
    await repository.create(phoneId, actorId, phone, 'iPhone · Safari', anHourFromNow())
    await repository.create(randomUUID(), actorId, laptop, 'MacBook · Chrome', anHourFromNow())

    const fromPhone = await whoAmI(`${SESSION_COOKIE}=${phone}`)
    const fromLaptop = await whoAmI(`${SESSION_COOKIE}=${laptop}`)
    expect(fromPhone.raw).toBe(fromLaptop.raw)

    // Отозвали телефон — ноутбук цел. Это и есть «выход с одного устройства» из MOL-57.
    await db.delete(sessions).where(eq(sessions.id, phoneId))

    expect((await whoAmI(`${SESSION_COOKIE}=${phone}`)).status).toBe(401)
    expect((await whoAmI(`${SESSION_COOKIE}=${laptop}`)).status).toBe(200)
  })
})

describe('ни один ответ с cookie не кешируется', () => {
  it('держится тем, что выставить её может ровно один модуль', () => {
    // Проверка Р-6 в той форме, в какой она и держится: заголовок `Set-Cookie` называет ровно
    // один файл, и он же ставит `no-store`. Список ручек устарел бы на следующей задаче — а это
    // нет.
    //
    // Ищется **имя заголовка в любом написании** (MOL-53, А8), а не литерал в одинарных
    // кавычках: прежняя версия звала `grep -rl "'set-cookie'"` и не увидела бы ни
    // `reply.header("set-cookie", …)`, ни `setHeader(\`set-cookie\`, …)`, ни `reply.setCookie`
    // из плагина. Чего не поймает никакая такая проверка — имени, собранного из кусков; это
    // предел метода, и он назван.
    const root = fileURLToPath(new URL('../src', import.meta.url))
    const names = /set-?cookie/i

    const guilty = walk(root)
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => names.test(codeOf(path)))
      .map((path) => path.slice(root.length + 1))

    expect(guilty).toEqual(['cookie.ts'])
  })

  it('и видно это на первой же ручке, которая продлевает сессию', async () => {
    const { cookie } = await signedIn(SESSION_TOUCH_AFTER_HOURS + 1)

    const seen: string[] = []
    for (const url of ['/actors/me', '/advice', '/trips/current', '/places/recent']) {
      const response = await app.inject({ method: 'GET', url, headers: { cookie } })
      if (response.headers['set-cookie'] !== undefined) {
        seen.push(url)
        expect(response.headers['cache-control']).toBe('no-store')
      }
    }

    // И сама проверка должна что-то поймать: продление случается на первой же ручке.
    expect(seen).not.toHaveLength(0)
  })
})

describe('токен не только url-safe', () => {
  it('сессия с обычным base64 живёт и продлевается, а не падает на вторые сутки', async () => {
    // Репозиторий принимает любой печатный ASCII (MOL-52, Р4), а cookie — алфавит RFC 6265.
    // Пока эти два правила расходились, такая сессия прекрасно читалась и падала пятисоткой
    // ровно в тот день, когда приходил срок её продлить.
    const actorId = await insertActor(db)
    const padded = randomBytes(32).toString('base64')
    expect(padded.endsWith('=')).toBe(true)
    const id = randomUUID()
    await repository.create(id, actorId, padded, null, anHourFromNow())
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - (SESSION_TOUCH_AFTER_HOURS + 1) * HOUR) })
      .where(eq(sessions.id, id))

    const mine = await whoAmI(`${SESSION_COOKIE}=${padded}`)

    expect(mine.status).toBe(200)
    expect(String(mine.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=${padded}`)
  })
})

/**
 * Фиксация сессии (MOL-53, А2, А3). Поставить cookie на этот хост может не только владелец
 * домена: в разработке — соседнее приложение на другом порту, потому что порт в «сайт» не
 * входит; позже — поддомен или XSS. Браузер шлёт более специфичный путь первым (RFC 6265 §5.4),
 * так что чужая cookie оказывается впереди нашей.
 */
describe('две cookie одного имени', () => {
  it('не исполняют запрос от чужого имени', async () => {
    const mine = await signedIn()
    const attacker = await signedIn()

    const both = await whoAmI(
      `${SESSION_COOKIE}=${attacker.cookie.split('=')[1] ?? ''}; ${mine.cookie}`,
    )

    expect(both.status).toBe(401)
    expect(JSON.parse(both.raw) as unknown).toEqual({ code: ERROR.NO_ACTOR })
  })

  it('и не дают стереть живую cookie чужой', async () => {
    // Гашение адресует имя, путь и домен, а не значение: оно сняло бы нашу, на `Path=/`, и
    // оставило чужую на более глубоком пути. Попытка подмены превратилась бы в запрет навсегда.
    const mine = await signedIn()

    const refused = await whoAmI(`${SESSION_COOKIE}=${aToken()}; ${mine.cookie}`)

    expect(refused.status).toBe(401)
    expect(refused.headers['set-cookie']).toBeUndefined()
    // И сессия цела: убрали чужую — снова свой.
    expect((await whoAmI(mine.cookie)).status).toBe(200)
  })

  it('пустое значение впереди живой — тоже две, и тоже отказ без гашения', async () => {
    const mine = await signedIn()

    const refused = await whoAmI(`${SESSION_COOKIE}=; ${mine.cookie}`)

    expect(refused.status).toBe(401)
    expect(refused.headers['set-cookie']).toBeUndefined()
  })

  it('контроль: одна живая cookie по-прежнему отвечает своим владельцем', async () => {
    const mine = await signedIn()

    const ok = await whoAmI(mine.cookie)

    expect(ok.status).toBe(200)
    expect(ok.headers['set-cookie']).toBeUndefined()
  })
})

describe('шов входа не слушается чужой страницы', () => {
  const login = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/dev/login', headers })

  it('кросс-сайтовый POST не получает сессии — для него адреса нет', async () => {
    // `SameSite=Lax` тут не помогает: он про отправку cookie, а не про установку. Без тела
    // предварительного запроса не бывает, так что чужая страница дотянулась бы (А5).
    const forced = await login({
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'no-cors',
    })

    expect(forced.statusCode).toBe(404)
    expect(forced.headers['set-cookie']).toBeUndefined()
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  it('и соседний сайт того же домена — тоже не получает', async () => {
    const sibling = await login({ 'sec-fetch-site': 'same-site' })

    expect(sibling.statusCode).toBe(404)
  })

  it('контроль: своё приложение, адресная строка и curl входят как входили', async () => {
    for (const headers of [{ 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }, {}]) {
      const allowed = await login(headers)

      expect(allowed.statusCode).toBe(201)
      expect(String(allowed.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`)
    }
  })
})

describe('два входа одним Telegram-аккаунтом', () => {
  it('одновременно — это один владелец и две сессии, а не CONFLICT', async () => {
    // Двойное нажатие кнопки в боте или повторная доставка апдейта (MOL-53, А4). Чтение и
    // запись — не один оператор, поэтому оба входа читают пусто и оба вставляют; проигравший
    // встречает уникальный индекс и **перечитывает**, а не отказывает человеку.
    const telegramUserId = telegramId()
    const actors = createActorRepository(db)

    const [first, second] = await Promise.all([
      signIn(actors, repository, telegramUserId),
      signIn(actors, repository, telegramUserId),
    ])

    expect(first.actor.id).toBe(second.actor.id)
    expect(first.token).not.toBe(second.token)
    expect(await db.select().from(sessions)).toHaveLength(2)
  })

  it('последовательно — то же самое', async () => {
    const telegramUserId = telegramId()
    const actors = createActorRepository(db)

    const first = await signIn(actors, repository, telegramUserId)
    const second = await signIn(actors, repository, telegramUserId)

    expect(second.actor.id).toBe(first.actor.id)
    expect(second.token).not.toBe(first.token)
  })
})

/**
 * «Владелец аккаунта не должен меняться» — решение владельца от 22.09.2026 (MOL-53, Б1/Б2).
 *
 * Шов чеканил новый Telegram-id на каждый вызов, поэтому истёкшая или отозванная сессия
 * возвращалась **другим человеком**, а всё, что устройство сложило под прежнего владельца —
 * прежде всего неотправленная очередь похода, — оставалось недостижимым. Теперь шов помнит
 * аккаунт этого браузера своей cookie: ровно то, чем в MOL-54 станет сам Telegram.
 */
describe('шов помнит аккаунт браузера', () => {
  const login = (cookie?: string) =>
    app.inject({
      method: 'POST',
      url: '/dev/login',
      ...(cookie === undefined ? {} : { headers: { cookie } }),
    })

  /** Все строки `Set-Cookie` ответа, сколько бы их ни было — одна или список. */
  function setCookies(headers: Record<string, unknown>): string[] {
    const set = headers['set-cookie']
    if (typeof set === 'string') return [set]
    return Array.isArray(set) ? set.filter((line): line is string => typeof line === 'string') : []
  }

  /** Одна из них по имени — то, что браузер приложит в следующий раз. */
  function cookieNamed(headers: Record<string, unknown>, name: string): string {
    const mine = setCookies(headers).find((line) => line.startsWith(`${name}=`)) ?? ''
    return mine.split(';')[0] ?? ''
  }

  it('второй вход того же браузера — тот же владелец и новая сессия', async () => {
    const first = await login()
    const account = cookieNamed(first.headers, DEV_ACCOUNT_COOKIE)
    expect(account).toContain(DEV_ACCOUNT_COOKIE)

    const second = await login(account)

    const was = (JSON.parse(first.body) as { id: string }).id
    const now = (JSON.parse(second.body) as { id: string }).id
    expect(now).toBe(was)
    expect(await db.select().from(actors)).toHaveLength(1)
    // Сессия всё равно новая: аккаунт — не ключ от него.
    expect(await db.select().from(sessions)).toHaveLength(2)
  })

  it('браузер без этой cookie — по-прежнему новый человек', async () => {
    const first = await login()
    const second = await login()

    expect((JSON.parse(second.body) as { id: string }).id).not.toBe(
      (JSON.parse(first.body) as { id: string }).id,
    )
  })

  it('подделанная или чужая cookie аккаунта не открывает чужого владельца', async () => {
    const mine = await login()
    const account = cookieNamed(mine.headers, DEV_ACCOUNT_COOKIE)

    // Число, которого колонка не примет; две cookie одного имени; не число вовсе.
    for (const bad of [
      `${DEV_ACCOUNT_COOKIE}=0`,
      `${DEV_ACCOUNT_COOKIE}=-1`,
      `${DEV_ACCOUNT_COOKIE}=9007199254740993`,
      `${DEV_ACCOUNT_COOKIE}=не число`,
      `${DEV_ACCOUNT_COOKIE}=`,
      `${account}; ${account}`,
    ]) {
      const forged = await login(bad)

      expect(forged.statusCode).toBe(201)
      // Не владелец из подделки и не ошибка — просто новый человек.
      expect((JSON.parse(forged.body) as { id: string }).id).not.toBe(
        (JSON.parse(mine.body) as { id: string }).id,
      )
    }
  })

  it('cookie аккаунта живёт дольше сессии и никем не читается из скрипта', async () => {
    const all = setCookies((await login()).headers)
    const account = all.find((one) => one.startsWith(`${DEV_ACCOUNT_COOKIE}=`)) ?? ''
    const session = all.find((one) => one.startsWith(`${SESSION_COOKIE}=`)) ?? ''

    expect(account).toContain('HttpOnly')
    expect(account).toContain('Secure')
    expect(account).toContain('Path=/')
    const age = (line: string) => Number(/Max-Age=(\d+)/.exec(line)?.[1] ?? '0')
    expect(age(account)).toBeGreaterThan(age(session))
  })
})
