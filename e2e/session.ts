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

/**
 * Открывает адрес приложения и, если эта банка cookie ещё без сессии, входит швом разработки
 * (MOL-56).
 *
 * До MOL-56 приложение входило само, и тесту хватало `page.goto`. Теперь всё приложение за
 * экраном входа — это и есть то, что задача делает, — а швом входят там же, где хотели
 * оказаться: лишняя навигация на `/` добавила бы записей в историю, по которой половина
 * `navigation.spec` и меряет «назад».
 *
 * Шаг «в чей аккаунт вошли» шов не показывает намеренно: он существует ради чужого
 * подтверждения по утёкшей ссылке, а здесь человек входит сам и никакого Telegram в этом нет.
 */
/**
 * Оба языка, потому что вход стоит перед каждым экраном, а язык спеки выбирает сама:
 * `settings.spec` идёт по-русски, остальные по-английски.
 */
export const DEV_SEAM = /^(Sign in for development|Войти для разработки)$/
const LOGIN_TITLE = /^(Sign in|Вход)$/

export async function open(page: Page, path = '/'): Promise<void> {
  const first = !(await page.context().cookies()).some((one) => one.name === SESSION_COOKIE)
  await page.goto(path)
  if (!first) return
  await page.getByRole('button', { name: DEV_SEAM }).click()
  // Дождаться, пока дверь откроется, а не просто нажать: тест, который пойдёт дальше сразу,
  // успевает перезагрузить страницу раньше, чем браузер запишет cookie сессии. Заголовок
  // экрана входа — единственное, что есть у него и чего нет ни у одного экрана приложения.
  await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(LOGIN_TITLE)
}

/** Открывает приложение, входит и отдаёт id владельца. */
export async function signedIn(page: Page): Promise<string> {
  await open(page)
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
