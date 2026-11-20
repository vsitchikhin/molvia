import type { Page } from '@playwright/test'
import { expect, test } from './csp'
import { signInBuilt } from './session'

// MOL-337, the built app (`pwa`): every screen but «Что брать» is a chunk of its own, and each language's
// dictionary another. An installed app opens with no connection any screen it has not opened yet — the
// precache holds them all — and a page no worker controls has every screen in memory once the first is
// drawn, so a tap goes nowhere near the network. Comes in by `page.goto`, as the other specs of the build.

/** A screen of each kind: the sections, a nested screen of each, and one open without a session. */
const SCREENS = [
  ['/', 'What to buy', 'Что брать'],
  ['/purchases', 'Purchases', 'Покупки'],
  ['/verdicts', 'Ratings', 'Оценки'],
  ['/money', 'Money', 'Деньги'],
  ['/money/accounts', 'Accounts', 'Счета'],
  ['/money/budget', 'Budget', 'Бюджет'],
  ['/settings', 'Settings', 'Настройки'],
  ['/settings/devices', 'Devices', 'Устройства'],
  ['/privacy', 'Data and privacy', 'Данные и приватность'],
] as const

const heading = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true })

test('an installed app opens every screen with no connection, in either language', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000)
  await signInBuilt(page, browserName)
  // Installed: the worker of this build controls the page, its precache filled.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true)

  await page.context().setOffline(true)
  for (const [path, english] of SCREENS) {
    await page.goto(path)
    await expect(heading(page, english)).toBeVisible()
  }
  // The other language's dictionary is in the precache too.
  await page.evaluate(() => {
    localStorage.setItem('molvia.locale', 'ru')
  })
  for (const [path, , russian] of SCREENS) {
    await page.goto(path)
    await expect(heading(page, russian)).toBeVisible()
  }
})

test.describe('no worker', () => {
  // The page that installs the worker is controlled by nothing to its end (`pwaUpdate.ts`); blocked, no
  // page is, and every screen it opens is what it loaded itself.
  test.use({ serviceWorkers: 'block' })

  test('once the first screen is drawn, every other one is loaded, and a tap needs no connection', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(60_000)
    // What the document on the screen loaded, by its own record: a page gone took its modules with it, and a
    // move inside the app is no new page. Room for every file of the build in the record.
    await page.addInitScript(() => {
      performance.setResourceTimingBufferSize(1000)
    })
    const files = () =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((entry) => new URL(entry.name).pathname)
          .filter((path) => path.startsWith('/assets/')),
      )
    const named = (paths: string[], pattern: RegExp) =>
      paths.flatMap((path) => pattern.exec(path)?.slice(1, 2) ?? [])
    await signInBuilt(page, browserName)
    // The sections and the nested screens below, loaded with no tap: the bundle holds home alone.
    await expect
      .poll(async () => named(await files(), /\/assets\/(\w+View)-[\w-]+\.js$/))
      .toEqual(
        expect.arrayContaining([
          'AccountsView',
          'MoneyView',
          'SettingsView',
          'VerdictsView',
          'DevicesView',
        ]),
      )
    // Every screen loaded, and the phone's one language: no screen pulls the other dictionary in (review №1).
    expect(named(await files(), /\/assets\/(ru|en)-[\w-]+\.js$/)).toEqual(['en'])

    await page.context().setOffline(true)
    const tabs = page.getByRole('navigation', { name: 'Sections' })
    for (const name of ['Ratings', 'Money', 'Settings'] as const) {
      await tabs.getByRole('link', { name, exact: true }).click()
      await expect(heading(page, name)).toBeVisible()
    }
    await page.getByRole('link', { name: 'Devices', exact: true }).click()
    await expect(heading(page, 'Devices')).toBeVisible()
  })
})
