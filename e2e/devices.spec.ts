import { devices, expect, test } from '@playwright/test'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { signedIn } from './session'

/**
 * Выход и список устройств (MOL-57) через настоящий браузер: два устройства одного аккаунта,
 * одно выгоняет другое, потом выходит само. Моком этого не показать — cookie `HttpOnly`, её
 * гасит только сервер, а «выгнанный видит экран входа» — это шов `401` и дверь MOL-56 вместе.
 */

test.use({ reducedMotion: 'reduce' })

/** The development seam remembers a browser's account in a cookie of its own (MOL-53). */
const DEV_ACCOUNT_COOKIE = '__Host-molvia_dev_account'

/**
 * A second device of the same account: a fresh context holding only the first one's account
 * cookie, so the seam signs it in as the same owner with a session of its own.
 */
async function secondDevice(
  browser: Browser,
  first: Page,
  testInfo: TestInfo,
): Promise<{ context: BrowserContext; page: Page }> {
  const account = (await first.context().cookies()).filter(
    (cookie) => cookie.name === DEV_ACCOUNT_COOKIE,
  )
  expect(account, 'the seam gave the first browser no account cookie').toHaveLength(1)
  // The phone the project runs as, spelled out: the project's own options carry fields a context
  // does not take.
  const { baseURL, locale } = testInfo.project.use
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    ...(baseURL ? { baseURL } : {}),
    ...(locale ? { locale } : {}),
    reducedMotion: 'reduce',
  })
  await context.addCookies(account)
  const page = await context.newPage()
  await signedIn(page)
  return { context, page }
}

async function openDevices(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await page.getByRole('link', { name: 'Devices', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Devices')
}

const LOGIN_TITLE = /^Sign in$/

test('one device ends another: the other meets the login screen, this one stays', async ({
  page,
  browser,
}, testInfo) => {
  const owner = await signedIn(page)
  const other = await secondDevice(browser, page, testInfo)
  try {
    expect(
      await other.page.evaluate(() => localStorage.getItem('molvia.actor')),
      'the second device is the same account',
    ).toBe(owner)

    await openDevices(page)
    const rows = page.getByRole('listitem')
    await expect(rows).toHaveCount(2)
    // This one first and marked, with no button; the other one can be ended.
    await expect(rows.first()).toContainText('This device')
    await expect(rows.first().getByRole('button')).toHaveCount(0)
    const end = rows.nth(1).getByRole('button', { name: /^End the session on / })
    await expect(end).toBeVisible()

    await end.click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: /^End the session on .+\?$/ })).toBeVisible()
    // The sheet takes no tap while it rises.
    await page.waitForTimeout(400)
    await sheet.getByRole('button', { name: 'End session', exact: true }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('This device')

    // The ended device learns it on its next request.
    await other.page.reload()
    await expect(other.page.getByRole('heading', { level: 1 })).toHaveText(LOGIN_TITLE)

    // And this one is untouched.
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Devices')
    await expect(rows).toHaveCount(1)
  } finally {
    await other.context.close()
  }
})

test('signing out here erases this device and leaves the other one signed in', async ({
  page,
  browser,
}, testInfo) => {
  const owner = await signedIn(page)
  const other = await secondDevice(browser, page, testInfo)
  try {
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(
      sheet.getByRole('heading', { name: 'Sign out of Molvia on this device?' }),
    ).toBeVisible()
    await page.waitForTimeout(400)
    await sheet.getByRole('button', { name: 'Sign out and erase', exact: true }).click()

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(LOGIN_TITLE)
    await expect(page).toHaveURL(/\/$/)
    // Nothing of the owner is left on the device: no drawer, so no launch without a connection
    // opens their app again (owner's decision Q1).
    const left = await page.evaluate((id) => {
      const keys: string[] = []
      for (const shelf of [localStorage, sessionStorage]) {
        for (let index = 0; index < shelf.length; index += 1) keys.push(shelf.key(index) ?? '')
      }
      return keys.filter((key) => key === 'molvia.actor' || key.endsWith(`.${id}`))
    }, owner)
    expect(left).toEqual([])

    // The other device is still in, and it lists itself alone now.
    await openDevices(other.page)
    const rows = other.page.getByRole('listitem')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('This device')
  } finally {
    await other.context.close()
  }
})
