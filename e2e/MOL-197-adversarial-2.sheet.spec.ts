import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
import { open } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * MOL-197, адверсариальное ревью, раунд 1, А2 — А1 на движке iPhone. ЗЕЛЁНЫЙ ТЕСТ = ДЕФЕКТ ЖИВ (кроме «К»).
 *
 * Имя файла кончается на `sheet.spec.ts`, чтобы его взял проект `iphone` (WebKit); `phone` гоняет его тоже — для
 * сверки с Chromium. В WebKit наименьшая ширина считается иначе: `SearchField` на 320 распирал грид кита до 357 только
 * там (MOL-177). WebKit не держит `Secure` cookie на http://127.0.0.1, поэтому cookie шва кладётся в каждый запрос
 * к API маршрутом — приём пробы, не продукта.
 */

function yesterday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  )
}

function topSheet(page: Page): Locator {
  return page.locator('dialog[open]').last()
}

async function pickerWith(page: Page, width: number, name: string) {
  await page.setViewportSize({ width, height: 740 })
  let cookie = ''
  // Every request of the app to the API goes through Playwright with the seam's cookie: WebKit takes no
  // `cookie` put in by `route.continue` (round 1, run 40499850771 — the door stayed «Вход»).
  await page.route('**/api/**', async (route) => {
    const headers = cookie ? { ...route.request().headers(), cookie } : undefined
    await route.fulfill({ response: await route.fetch(headers ? { headers } : undefined) })
  })
  // The seam's cookie is taken before the page gets the answer, so no request of the app goes without it.
  await page.route('**/api/dev/login', async (route) => {
    const answer = await route.fetch()
    for (const { name: header, value } of answer.headersArray()) {
      const pair = value.split(';')[0] ?? ''
      if (header.toLowerCase() === 'set-cookie' && pair.startsWith(`${SESSION_COOKIE}=`)) {
        cookie = pair
      }
    }
    await route.fulfill({ response: answer })
  })
  await open(page, '/money')
  await expect.poll(() => cookie, { message: 'шов не отдал cookie' }).not.toBe('')
  const response = await page.request.post('/api/money/accounts', {
    headers: { cookie },
    data: {
      id: randomUUID(),
      name,
      currency: 'AMD',
      savings: false,
      start: { amount: '1000', currency: 'AMD' },
      startOn: yesterday(),
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  // «Счета» спрашиваются, когда экран показан: уйти на «Что брать» и вернуться, без перезагрузки.
  await page.getByRole('link', { name: 'Что брать', exact: true }).click()
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
  await page.getByRole('button', { name: 'Добавить трату' }).click()
  await expect(topSheet(page)).toContainText('Новая трата')
  await page.waitForTimeout(400)
  await topSheet(page)
    .getByRole('button', { name: /Выбрать счёт:/ })
    .click()
  const picker = topSheet(page)
  await expect(picker).toContainText('Остатки — на сейчас')
  await expect(picker.getByRole('radio', { name: new RegExp(name.slice(0, 8)) })).toBeChecked()
  await page.waitForTimeout(400)
  const look = await picker.evaluate((dialog) => {
    const row = dialog.querySelector('[role="radio"][aria-checked="true"]')
    const title = row?.querySelector('.title')
    const check = row?.querySelector('.check')
    if (!row || !title || !check) throw new Error('another shape')
    return {
      viewport: window.innerWidth,
      sideways: dialog.scrollWidth - dialog.clientWidth,
      row: Math.round(row.getBoundingClientRect().width),
      checkRight: Math.round(check.getBoundingClientRect().right),
      titleCut: title.scrollWidth > title.clientWidth,
    }
  })
  console.log(
    `MOL-197 A2 ${test.info().project.name} ${String(width)} «${name}»: ${JSON.stringify(look)}`,
  )
  return look
}

test('А2: имя из теста самого PR на 320 — шторка выбора шире экрана, ✓ за краем', async ({
  page,
}) => {
  const look = await pickerWith(page, 320, 'Кредитка с очень длинным именем ֏')
  expect.soft(look.sideways, 'шторка выбора листается вбок').toBeGreaterThan(0)
  expect.soft(look.checkRight, '✓ выбранной строки за правым краем экрана').toBeGreaterThan(320)
})

test('А2 (К): короткое имя на 320 — шторка по экрану (контроль, зелёный = замер честный)', async ({
  page,
}) => {
  const look = await pickerWith(page, 320, 'Наличные ֏')
  expect.soft(look.sideways).toBe(0)
  expect.soft(look.checkRight).toBeLessThanOrEqual(320)
})
