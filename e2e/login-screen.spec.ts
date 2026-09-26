import process from 'node:process'
import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
import type { APIRequestContext, Page } from '@playwright/test'

/**
 * Круг «вход начат в приложении → подтверждён в Telegram → приложение узнало человека», через
 * настоящий браузер и настоящий API (MOL-56).
 *
 * Бота в прогоне нет — его половину играет внутренний канал MOL-54, тот же, которым ходит
 * настоящий бот. Что здесь и правда проверяется, и чего не показывает ни один компонентный
 * тест: ссылка, которую открывает приложение, живёт в настоящем `window.open`; запрос
 * переживает перезагрузку страницы; возврат на вкладку забирает сессию; и дальше приложение
 * открывается **на том адресе, куда человек шёл**.
 */
const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? ''}`
const BOT_SECRET = 'e'.repeat(43)

/** Telegram в прогоне не поднимается: ссылку ловим, но никуда не идём. */
async function withoutTelegram(page: Page): Promise<void> {
  await page
    .context()
    .route('https://t.me/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Telegram</title>' }),
    )
}

/** Нажимает «Войти через Telegram» и отдаёт код из ссылки, которую выдал сервер. */
async function start(page: Page): Promise<string> {
  const started = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/login') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Sign in with Telegram' }).click()
  const body: unknown = await (await started).json()
  const url = (body as { url: string }).url
  const code = new URL(url).searchParams.get('start')
  expect(code).toBeTruthy()
  return code ?? ''
}

/** То, что делает бот, когда человек нажимает «Войти». */
async function confirm(request: APIRequestContext, code: string): Promise<void> {
  const response = await request.post(`${api}/internal/auth/login/${code}/confirm`, {
    headers: { authorization: `Bearer ${BOT_SECRET}` },
    data: { telegramUserId: randomInt(1, 2 ** 40) },
  })
  expect(response.status()).toBe(204)
}

/** Возвращение из Telegram — для приложения это именно оно. */
async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
}

test('вход целиком, и человек оказывается там, куда шёл', async ({ page, request }) => {
  await withoutTelegram(page)
  // Ссылка из бота ведёт в раздел, а не на главную: адрес обязан пережить вход.
  await page.goto('/advice')

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
  const code = await start(page)
  await expect(page.getByRole('heading', { name: 'Open Telegram and tap «Sign in»' })).toBeVisible()

  await confirm(request, code)
  await comeBack(page)

  // Сначала — в чей аккаунт вошли, и только потом приложение.
  await expect(page.getByRole('heading', { name: 'Is this your account?' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden()
  await page.getByRole('button', { name: 'Yes, that is me' }).click()

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('What to buy')
  await expect(page).toHaveURL('/advice')
  expect((await page.context().cookies()).some((one) => one.name === SESSION_COOKIE)).toBe(true)
})

test('перезагрузка посреди круга не теряет запрос', async ({ page, request }) => {
  // iOS выгружает PWA, пока человек в Telegram. Если бы запрос жил только в памяти вкладки,
  // подтверждение, которое человек уже дал, приезжать было бы некуда.
  await withoutTelegram(page)
  await page.goto('/')
  const code = await start(page)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Open Telegram and tap «Sign in»' })).toBeVisible()

  await confirm(request, code)
  await comeBack(page)

  await expect(page.getByRole('heading', { name: 'Is this your account?' })).toBeVisible()
})

test('погашенная ссылка предлагает начать заново, а не молчит', async ({ page, request }) => {
  await withoutTelegram(page)
  await page.goto('/')
  const code = await start(page)

  // «Это не я» в боте: запрос гаснет, сессии не будет.
  const declined = await request.post(`${api}/internal/auth/login/${code}/decline`, {
    headers: { authorization: `Bearer ${BOT_SECRET}` },
  })
  expect(declined.status()).toBe(204)
  await comeBack(page)

  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Telegram' })).toBeVisible()
  expect((await page.context().cookies()).some((one) => one.name === SESSION_COOKIE)).toBe(false)
})

test('сессия, которой не стало, поднимает экран входа с любого экрана', async ({ page }) => {
  // Шов на `error.no_actor` живёт в одном месте, и проверить его можно только так: у экрана
  // «Что брать» своего разбора отказа нет, и до MOL-56 он показывал «что-то пошло не так».
  await page.goto('/')
  // The home screen without a trip asks for the history and the verdict queue by itself
  // (MOL-77). Answered after the session is gone, either one raises the door before «What to
  // buy» is pressed — right, but not the path this test is about — so both are let in first.
  const home = Promise.all(
    ['/api/trips/history', '/api/verdicts/pending'].map((path) =>
      page.waitForResponse((response) => response.url().includes(path)),
    ),
  )
  await page.getByRole('button', { name: 'Sign in for development' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trip')
  await home

  // Ждём, пока cookie сессии окажется в банке: под нагрузкой чтение банки успевает опередить
  // её запись, и тогда «убрать сессию» убирает пустоту, а приложение остаётся вошедшим.
  await expect
    .poll(async () => (await page.context().cookies()).map((one) => one.name))
    .toContain(SESSION_COOKIE)
  await page.context().clearCookies({ name: SESSION_COOKIE })
  // Ждём именно отказа, а не «когда-нибудь»: экран сменится после него, и ждать наугад значит
  // мерить скорость машины, а не поведение приложения.
  const refused = page.waitForResponse(
    (response) => response.url().includes('/api/advice') && response.status() === 401,
  )
  await page.getByRole('link', { name: 'What to buy' }).click()
  await refused

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
})
