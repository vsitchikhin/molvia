import { expect } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
import type { Page } from '@playwright/test'

/**
 * Как тест ходит в API от лица той же личности, что и страница (MOL-53).
 *
 * **Почему заголовок руками, а не «page.request сам возьмёт cookie».** Он и правда делит банку
 * с контекстом браузера — но cookie сессии помечена `Secure`, а стенд e2e поднят по http на
 * `127.0.0.1`. Браузер такую cookie на loopback отправляет (localhost считается достоверным
 * источником, и `actor.spec` это показывает); клиент запросов Playwright держится буквы
 * RFC 6265 и по http её не шлёт. Это свойство инструмента, а не продукта, поэтому тест берёт
 * cookie из банки контекста и прикладывает сам.
 *
 * Отдельный модуль, а не копия в каждом файле: ровно этот довод пришлось бы объяснять пять раз.
 */
const OWNER_KEY = 'molvia.actor'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Открывает приложение и ждёт, пока оно само войдёт через шов. Отдаёт id владельца. */
export async function signedIn(page: Page): Promise<string> {
  await page.goto('/')
  const owner = () => page.evaluate((key) => localStorage.getItem(key) ?? '', OWNER_KEY)
  // Вход случается после первой отрисовки, поэтому владелец появляется мгновением позже.
  await expect.poll(owner).toMatch(UUID)
  return owner()
}

/** Заголовки для `page.request`, несущие cookie этого самого браузера. */
export async function asBrowser(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies()
  const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE)
  expect(session, 'браузер не вошёл: cookie сессии нет').toBeDefined()
  return { cookie: `${SESSION_COOKIE}=${session?.value ?? ''}` }
}
