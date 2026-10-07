import { expect, test } from '@playwright/test'
import { POLICY_VERSION, SESSION_COOKIE } from '@molvia/model'
import type { Page, Request, Response } from '@playwright/test'

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
/** The step of the door after the claim (MOL-95), in both languages, as the seam is. */
export const AGE = /^(I am 16 or older|Мне 16 лет или больше)$/
export const ACCEPT = /^(I accept|Принимаю)$/
/**
 * Где старый `open()` уже упал бы — пять секунд `expect` по умолчанию. Не новый порог: дольше него
 * вход оставляет след в отчёте, короче — нет, потому что это обычная машина.
 */
const SLOW_ANSWER_MS = 5_000

function isSeam(request: Request): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === '/api/dev/login'
}

/**
 * Ответ шва — или его обрыв, который называется сразу (MOL-67, ревью Р-4). Ответа у оборванного
 * запроса нет вовсе: экран входа уже сказал «не вышло», а ожидание одного ответа длилось бы до
 * таймаута теста и читалось бы как медленный стенд.
 *
 * **Ответ ждёт вызов Playwright, а не своё обещание на `page.on`** (ревью В2). Таймаут теста
 * называет вызов, который был в полёте, и его строку; у своего обещания вызова нет, и зависший шов
 * читался голым «Test timeout» без места. `requestfailed` при закрытии страницы не приходит, так
 * что медленный стенд не выдаёт себя за обрыв.
 */
async function seamAnswer(page: Page): Promise<Response> {
  let stop: () => void = () => undefined
  const cutOff = new Promise<never>((_resolve, reject) => {
    const failed = (request: Request) => {
      if (!isSeam(request)) return
      reject(new Error(`запрос шва оборвался без ответа: ${request.failure()?.errorText ?? '?'}`))
    }
    page.on('requestfailed', failed)
    stop = () => {
      page.off('requestfailed', failed)
    }
  })
  try {
    return await Promise.race([
      // Таймаут здесь — стенд не ответил на вход швом за всё время теста (MOL-67): не спека.
      page.waitForEvent('response', { predicate: (one) => isSeam(one.request()), timeout: 0 }),
      cutOff,
    ])
  } finally {
    stop()
  }
}

export async function open(page: Page, path = '/'): Promise<void> {
  const first = !(await page.context().cookies()).some((one) => one.name === SESSION_COOKIE)
  // **WebKit keeps no `Secure` cookie on http://127.0.0.1** (`sheet.spec`, MOL-80): every request
  // after the seam's answer comes in signed out, and the step's question about the terms (MOL-95)
  // turned the page into the login screen before the sheet was ever opened. The step is not what the
  // engine is there for — `consent.spec` holds it on Chromium — so here it is answered «accepted».
  if (first && page.context().browser()?.browserType().name() === 'webkit') {
    await page.route('**/api/actors/me/consent', (route) =>
      route.fulfill({ json: { version: POLICY_VERSION } }),
    )
  }
  await page.goto(path)
  if (!first) return
  // Ответ шва и дверь ждутся порознь, потому что медленным бывает только первое (MOL-67).
  //
  // **Ответ — без своего предела.** Так его ждёт само приложение: `devLogin` в `@molvia/client` —
  // единственный запрос без таймаута. На перегруженном стенде он и есть медленная часть: 8
  // воркеров с замедленным CPU — до 23 с, большая часть — в самом API, а на свободной машине —
  // меньше секунды. Это правда про стенд, а не про продукт: в прод-сборке шва нет. `Promise.all`,
  // а не ожидание, заведённое до нажатия: оно подписывается и на отказ, если упадёт само нажатие.
  const info = test.info()
  const started = Date.now()
  const answer = await test.step('вход швом: ответ сервера', async () => {
    const [response] = await Promise.all([
      seamAnswer(page),
      page.getByRole('button', { name: DEV_SEAM }).click(),
    ])
    return response
  })
  // **Сколько стенд думал над входом, столько тест и получает обратно** (ревью Р-1, Р-2). Без
  // этого «без предела» значило «из бюджета спеки»: вход за 27 с проходил, а тело падало через три
  // секунды на своём шаге, и сообщение о входе молчало. Возвращается ровно выжданное, а не
  // подобранное число — и только конечному бюджету: таймаут 0 значит «без предела» (`--timeout 0`,
  // `--debug`, `PWDEBUG=1`), и `0 + waited` сделал бы из него предел длиной во вход (ревью Т-1).
  //
  // **Цена названа** (ревью Т-2): вход, замедленный самим продуктом — шов идёт через тот же
  // `signIn`, что и настоящий вход, — тоже больше не падает на двери. На свободной машине шов
  // отвечает меньше чем за секунду, поэтому вложение ниже там — находка о продукте, а не стенд.
  const waited = Date.now() - started
  const finite = info.timeout > 0
  if (finite) info.setTimeout(info.timeout + waited)
  if (waited > SLOW_ANSWER_MS) {
    const seconds = (waited / 1000).toFixed(1).replace('.', ',')
    await info.attach('вход швом', {
      body: `нажатие и ответ — ${seconds} с: стенд перегружен${finite ? '; столько же добавлено к таймауту теста' : ''}`,
      contentType: 'text/plain',
    })
  }
  expect(answer.status(), 'шов разработки не впустил').toBe(201)
  // **Новый владелец шва ещё не принял условия** (MOL-95): шаг стоит между входом и приложением, и
  // тест проходит его, как человек, — галочкой и кнопкой. Свой спек у шага — `consent.spec`. Шов,
  // вернувший владельца, чьё согласие устройство помнит, шага не показывает, поэтому ждётся одно
  // из двух.
  const age = page.getByRole('checkbox', { name: AGE })
  const app = page.getByRole('heading', { level: 1 }).filter({ hasNotText: LOGIN_TITLE })
  await expect(age.or(app), 'ответ шва пришёл, а ни шага согласия, ни приложения').toBeVisible()
  if (await age.isVisible()) await acceptTerms(page)
  // **Дверь — прежние пять секунд, и поднимать их нельзя.** От ответа до неё — синхронная
  // цепочка (`settle`, `claim`) и одна отрисовка, ждать тут нечего; упала эта проверка — это
  // дефект входа (`verify()`, `claimed`, MOL-56), а не медленная машина. Заголовок экрана входа —
  // единственное, что есть у него и нет ни у одного экрана приложения.
  await expect(
    page.getByRole('heading', { level: 1 }),
    'ответ шва пришёл, а дверь не открылась — это вход, а не стенд',
  ).not.toHaveText(LOGIN_TITLE)
}

/** «Мне 16 лет или больше» и «Принимаю» на шаге согласия (MOL-95). */
export async function acceptTerms(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: AGE }).check()
  await page.getByRole('button', { name: ACCEPT }).click()
}

/** Открывает приложение, входит и отдаёт id владельца. */
export async function signedIn(page: Page, path = '/'): Promise<string> {
  await open(page, path)
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

/**
 * Связь пропала — и страница это уже встретила (MOL-217).
 *
 * `setOffline` отвечает раньше, чем Chromium гарантированно отказывает каждому запросу страницы: в
 * CI оценка, поставленная сразу после него, дошла до сервера, а телефон счёл её неотправленной.
 * Поэтому офлайн считается наступившим, когда запрос самой страницы упал. Брать там, где спека
 * дальше утверждает, чего сервер не получил.
 */
export async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true)
  await expect
    .poll(() =>
      page.evaluate(() =>
        fetch('/api/health', { cache: 'no-store' }).then(
          () => 'online',
          () => 'offline',
        ),
      ),
    )
    .toBe('offline')
}
