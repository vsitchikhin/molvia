/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import process from 'node:process'
import { expect, test } from '@playwright/test'
import type { APIResponse, Page } from '@playwright/test'

/**
 * «What did you pick up?» against the real API and the real catalogue search: transliteration and
 * typos are Postgres's, the pause and the cancellation are the browser's timers and `fetch`. The
 * component tests drive the same screen with a mocked client; what they cannot show is that the
 * whole road — the field, the proxy, the server, the ranking — answers the way the screen expects.
 *
 * The items are added the way the screen adds them, through «Предложить товар» on the API. The
 * development database is shared with whoever uses this copy, so the names are ones nobody types,
 * and a proposal answered «already there» is as good as a new one.
 */

const KEY = 'molvia.actor'

function inviteCode(): string {
  const code = process.env.SIGNUP_CODE
  if (!code) {
    throw new Error("SIGNUP_CODE is not set. Run `make setup` to generate this copy's .env.")
  }
  return code
}

/** A word no catalogue holds: letters only, so it grounds a search and matches nothing else. */
function nonsense(): string {
  const consonants = 'бвгджзклмнпрстфхцчш'
  const vowels = 'аоуиэы'
  let word = ''
  for (let i = 0; i < 5; i += 1) {
    word += consonants.charAt(Math.floor(Math.random() * consonants.length))
    word += vowels.charAt(Math.floor(Math.random() * vowels.length))
  }
  return word
}

const field = (page: Page) => page.getByRole('combobox', { name: 'What did you pick up?' })
const options = (page: Page) => page.getByRole('option')

/** A device with an identity, the way a person gets one: through the invite link. */
async function arrive(page: Page): Promise<string> {
  await page.goto(`/?c=${inviteCode()}`)
  const stored = () => page.evaluate((key) => localStorage.getItem(key) ?? '', KEY)
  // The first visit happens after the first paint, so the identity appears a moment later.
  await expect.poll(stored).toMatch(/^[0-9a-f-]{36}$/)
  return stored()
}

async function propose(
  page: Page,
  actor: string,
  item: {
    readonly name: string
    readonly defaultUnit: 'kg' | 'l' | 'piece'
    readonly note?: string
  },
): Promise<APIResponse> {
  const response = await page.request.post('/api/catalogue/items', {
    headers: { 'x-molvia-actor': actor },
    data: { kind: 'product', ...item },
  })
  expect([200, 201]).toContain(response.status())
  return response
}

const KVIRTA_MILK = {
  name: 'Молоко «Квирта»',
  defaultUnit: 'l',
  note: 'пастеризованное, 3,2%',
} as const
const KVIRTA_KEFIR = { name: 'Кефир «Квирта»', defaultUnit: 'l' } as const

/**
 * Two items in the catalogue and the search open. `recent` — the milk is among the items this
 * device added to trips, as the sheet of MOL-24 will write it: the card exactly as the API sent it.
 */
async function withKvirta(page: Page, options: { recent?: boolean } = {}): Promise<void> {
  const actor = await arrive(page)
  const milk: unknown = await (await propose(page, actor, KVIRTA_MILK)).json()
  await propose(page, actor, KVIRTA_KEFIR)
  if (options.recent) {
    await page.evaluate(
      ([key, cards]) => {
        localStorage.setItem(key, cards)
      },
      [`molvia.recent.${actor}`, JSON.stringify([milk])] as const,
    )
  }
  await page.goto('/trip/add')
  await expect(field(page)).toBeFocused()
}

test.describe('finding an item', () => {
  test('by a typo and by Latin letters, the right one first', async ({ page }) => {
    await withKvirta(page)

    for (const query of ['молоко квирт', 'малако квирта', 'moloko kvirta']) {
      await field(page).fill(query)
      await expect(options(page).first(), query).toContainText(KVIRTA_MILK.name)
    }
    await expect(options(page).first()).toContainText(KVIRTA_MILK.note)
  })

  test('with one search per pause in typing', async ({ page }) => {
    await withKvirta(page)
    const searches: string[] = []
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname.endsWith('/catalogue/search')) searches.push(url.searchParams.get('q') ?? '')
    })

    await field(page).pressSequentially('квирта', { delay: 40 })

    await expect(options(page).first()).toBeVisible()
    expect(searches).toEqual(['квирта'])
  })

  test('reads the count out once the answer is in', async ({ page }) => {
    await withKvirta(page)

    await field(page).fill('квирта')

    await expect(page.locator('.announcer')).toContainText(/Found \d+ items?/)
  })

  test('asks nothing about an empty field', async ({ page }) => {
    await withKvirta(page)
    const searches: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/catalogue/search')) searches.push(request.url())
    })

    await field(page).fill('   ')
    await page.waitForTimeout(400)

    expect(searches).toEqual([])
  })

  test('every row is big enough for a thumb', async ({ page }) => {
    await withKvirta(page)
    await field(page).fill('квирта')
    await expect(options(page).first()).toBeVisible()

    for (const row of await options(page).all()) {
      expect((await row.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('from the keyboard', () => {
  test('arrows make a row active for a screen reader, and none is active before', async ({
    page,
  }) => {
    await withKvirta(page)
    await field(page).fill('квирта')
    await expect(options(page)).not.toHaveCount(0)

    await expect(field(page)).not.toHaveAttribute('aria-activedescendant', /.+/)
    await field(page).press('ArrowDown')
    await field(page).press('ArrowDown')

    const second = options(page).nth(1)
    await expect(field(page)).toHaveAttribute(
      'aria-activedescendant',
      (await second.getAttribute('id')) ?? '',
    )
    await expect(second).toHaveAttribute('aria-selected', 'true')
  })

  test('the active row is never left under the pinned bar, going down or wrapping to the top', async ({
    page,
  }) => {
    const actor = await arrive(page)
    const sorts = ['альфа', 'бета', 'гамма', 'дельта', 'эпсилон', 'дзета', 'эта', 'тета', 'йота']
    const more = ['каппа', 'лямбда', 'мю', 'ню', 'кси', 'омикрон', 'пи', 'ро', 'сигма', 'тау', 'фи']
    for (const sort of [...sorts, ...more]) {
      await propose(page, actor, { name: `Квирта ${sort}`, defaultUnit: 'piece' })
    }
    await page.goto('/trip/add')
    await field(page).fill('квирта')
    await expect(options(page)).toHaveCount(20)

    const bar = page.locator('header.bar')
    async function activeIsClear(): Promise<void> {
      const id = await field(page).getAttribute('aria-activedescendant')
      const row = page.locator(`[id="${id ?? ''}"]`)
      const [rowBox, barBox] = await Promise.all([row.boundingBox(), bar.boundingBox()])
      const viewport = page.viewportSize()
      expect(rowBox && barBox && viewport).toBeTruthy()
      if (!rowBox || !barBox || !viewport) return
      expect(rowBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1)
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(viewport.height + 1)
    }

    for (let step = 0; step < 20; step += 1) await field(page).press('ArrowDown')
    await expect(options(page).last()).toHaveAttribute('aria-selected', 'true')
    await activeIsClear()

    for (let step = 0; step < 12; step += 1) await field(page).press('ArrowUp')
    await activeIsClear()

    // From the last row down wraps to the first, far above: the page scrolls up to it.
    for (let step = 0; step < 12; step += 1) await field(page).press('ArrowDown')
    await expect(options(page).last()).toHaveAttribute('aria-selected', 'true')
    await field(page).press('ArrowDown')
    await expect(options(page).first()).toHaveAttribute('aria-selected', 'true')
    await activeIsClear()
  })

  test('Enter with no active row hides the keyboard and picks nothing', async ({ page }) => {
    await withKvirta(page)
    await field(page).fill('квирта')
    await expect(options(page)).not.toHaveCount(0)

    await field(page).press('Enter')

    await expect(field(page)).not.toBeFocused()
    await expect(page).toHaveURL(/\/trip\/add$/)
  })
})

test.describe('nothing found', () => {
  test('offers «Suggest an item», and the item comes back the same when suggested twice', async ({
    page,
  }) => {
    await arrive(page)
    await page.goto('/trip/add')
    const word = nonsense()

    await field(page).fill(word)
    // The block on the screen, not the live region, which says the same words (Р-10).
    await expect(page.locator('.not-found-text')).toContainText(`Nothing found for «${word}»`)

    const statuses: number[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/catalogue/items')) statuses.push(response.status())
    })

    for (const expected of [201, 200]) {
      await page.getByRole('button', { name: 'Suggest an item' }).click()
      const sheet = page.getByRole('dialog', { name: 'New item' })
      await expect(sheet).toBeVisible()
      await expect(sheet.getByLabel('As the price tag says')).toHaveValue(word)

      const submit = sheet.getByRole('button', { name: 'Add to the catalogue' })
      await expect(submit).toBeDisabled()
      // The sheet takes no tap while it is still coming up (MOL-18), so the tap is repeated
      // until the unit is taken — as a person would tap again.
      const litre = sheet.getByRole('radio', { name: 'l', exact: true })
      await expect(async () => {
        await sheet.getByText('l', { exact: true }).click()
        await expect(litre).toBeChecked({ timeout: 200 })
      }).toPass({ timeout: 5000 })
      await submit.click()

      await expect(sheet).toBeHidden()
      await expect.poll(() => statuses.at(-1)).toBe(expected)

      // The item suggested is picked: its sheet «how much» comes up once the form's is put
      // away (MOL-24), and × leaves the search as it was, with nothing written.
      const details = page.getByRole('dialog', { name: word })
      await expect(details).toBeVisible()
      await page.waitForTimeout(400)
      await details.getByRole('button', { name: 'Close' }).click()
      await expect(details).toBeHidden()
    }
    // The sheet stepped back off its own entry each time: the search is where it was.
    await expect(page).toHaveURL(/\/trip\/add$/)
    await expect(field(page)).toHaveValue(word)
  })
})

test.describe('without the server', () => {
  test('offline: says so without red, searches the recent items, and comes back by itself', async ({
    page,
    context,
  }) => {
    await withKvirta(page, { recent: true })
    await expect(options(page)).toHaveText([new RegExp(KVIRTA_MILK.name)])

    await context.setOffline(true)
    await field(page).fill('квирт')

    await expect(page.getByText('No connection')).toBeVisible()
    await expect(page.locator('.tone-bad')).toHaveCount(0)
    await expect(options(page)).toHaveText([new RegExp(KVIRTA_MILK.name)])

    await field(page).fill('кефир')
    await expect(options(page)).toHaveCount(0)

    const searches: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/catalogue/search')) searches.push(request.url())
    })
    await context.setOffline(false)

    await expect(options(page).first()).toContainText(KVIRTA_KEFIR.name)
    expect(searches.length).toBeGreaterThan(0)
  })

  test('an error offers «Try again» and the recent items', async ({ page }) => {
    await withKvirta(page, { recent: true })
    await page.route('**/api/catalogue/search**', (route) => route.abort())

    await field(page).fill('квирта')

    await expect(page.getByText('The server did not answer')).toBeVisible()
    await page.getByRole('button', { name: 'Pick from recent' }).click()
    await expect(options(page)).toHaveText([new RegExp(KVIRTA_MILK.name)])

    await page.unroute('**/api/catalogue/search**')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(options(page).first()).toContainText('Квирта')
  })

  test('the skeleton does not pulse for someone who asked for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await withKvirta(page)
    await page.route('**/api/catalogue/search**', () => {
      // Never answered: the skeleton stays for the check.
    })

    await field(page).fill('квирта')

    const bar = page.locator('.loading .line').first()
    await expect(bar).toBeVisible()
    expect(await bar.evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
  })
})
