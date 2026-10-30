/// <reference lib="dom" />
// DOM for the code inside page.evaluate, which runs in the browser.
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, open, signedIn } from './session'
import type { APIResponse, Locator, Page } from '@playwright/test'

/**
 * «What did you pick up?» against the real API and the real catalogue search: transliteration and
 * typos are Postgres's, the pause and the cancellation are the browser's timers and `fetch`. The
 * component tests drive the same screen with a mocked client; what they cannot show is that the
 * whole road — the field, the proxy, the server, the ranking — answers the way the screen expects.
 *
 * The items are added the way the screen adds them, through «Предложить товар» on the API. The
 * database is the run's own and is recreated before it (MOL-60), so nothing here is inherited
 * from yesterday — but the whole suite shares it while running in parallel, which is why the
 * names are ones nobody else types and a proposal answered «already there» is as good as a new one.
 */

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

/** A device signed in, the way a person gets in until MOL-54: the seam. */
async function arrive(page: Page): Promise<string> {
  return signedIn(page)
}

async function propose(
  page: Page,
  item: {
    readonly name: string
    readonly defaultUnit: 'kg' | 'l' | 'piece'
    readonly note?: string
  },
): Promise<APIResponse> {
  const response = await page.request.post('/api/catalogue/items', {
    headers: await asBrowser(page),
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

const OFFLINE_STRIP =
  'Offline · searching your recent items only. The full catalogue comes back with a connection'

/**
 * The owner's iPhone in Safari and its keys with the bar over them (MOL-135: `innerHeight` 699, 395 left
 * over the keys): what a state of this screen offers is tapped while the field holds them up, so it must
 * stand above them. Measured on that window, not the Pixel of the project — 839 tall, it left 140 px the
 * phone has not got (adversarial А5). The window of Chromium does not shrink, so this is the geometry
 * alone — the strip at the bottom fails it.
 */
const OWNER_IPHONE = { width: 390, height: 699 }
const OVER_THE_KEYS = OWNER_IPHONE.height - 304

/**
 * Where the state's buttons stand once it has come in: `appear` lifts the block into place, and a box
 * read on the way is lower, or two read one after the other stand apart (CI, 1.4 px at 360).
 */
async function settled(button: Locator): Promise<void> {
  await expect(button).toBeVisible()
  await button.evaluate((node) =>
    Promise.all(
      (node.closest('.state') ?? node).getAnimations({ subtree: true }).map((one) => one.finished),
    ),
  )
}

async function aboveTheKeys(button: Locator): Promise<void> {
  await settled(button)
  const box = await button.boundingBox()
  expect(box!.y + box!.height, 'the button stands under the keys').toBeLessThanOrEqual(
    OVER_THE_KEYS,
  )
}

/**
 * Two items in the catalogue and the search open. `recent` — the milk is among the items this
 * device added to trips, as the sheet of MOL-24 will write it: the card exactly as the API sent it.
 */
async function withKvirta(page: Page, options: { recent?: boolean } = {}): Promise<void> {
  const actor = await arrive(page)
  const milk: unknown = await (await propose(page, KVIRTA_MILK)).json()
  await propose(page, KVIRTA_KEFIR)
  if (options.recent) {
    await page.evaluate(
      ([key, cards]) => {
        localStorage.setItem(key, cards)
      },
      [`molvia.recent.${actor}`, JSON.stringify([milk])] as const,
    )
  }
  await page.goto('/purchases/manual/add')
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
    await arrive(page)
    const sorts = ['альфа', 'бета', 'гамма', 'дельта', 'эпсилон', 'дзета', 'эта', 'тета', 'йота']
    const more = ['каппа', 'лямбда', 'мю', 'ню', 'кси', 'омикрон', 'пи', 'ро', 'сигма', 'тау', 'фи']
    for (const sort of [...sorts, ...more]) {
      await propose(page, { name: `Квирта ${sort}`, defaultUnit: 'piece' })
    }
    await page.goto('/purchases/manual/add')
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
    await expect(page).toHaveURL(/\/purchases\/manual\/add$/)
  })
})

test.describe('nothing found', () => {
  test('offers «Suggest an item», and the item comes back the same when suggested twice', async ({
    page,
  }) => {
    await page.setViewportSize(OWNER_IPHONE)
    await arrive(page)
    await page.goto('/purchases/manual/add')
    const word = nonsense()

    await field(page).fill(word)
    // The heading of the state, not the live region, which says the same words (MOL-64).
    await expect(
      page.getByRole('heading', { name: `Nothing found for «${word}»`, exact: true }),
    ).toBeVisible()

    const statuses: number[] = []
    page.on('response', (response) => {
      if (response.url().endsWith('/catalogue/items')) statuses.push(response.status())
    })

    await aboveTheKeys(page.getByRole('button', { name: 'Suggest an item' }))

    for (const expected of [201, 200]) {
      await page.getByRole('button', { name: 'Suggest an item' }).click()
      const sheet = page.getByRole('dialog', { name: 'New item' })
      await expect(sheet).toBeVisible()
      await expect(sheet.getByLabel('As the price tag says')).toHaveValue(word)

      // Not now says why, and stays in the focus order (MOL-213, Ф-6).
      const waiting = sheet.getByRole('button', { name: 'Choose a unit' })
      // Playwright reads `aria-disabled` as disabled, so the native attribute is asked for by name.
      await expect(waiting).toHaveAttribute('aria-disabled', 'true')
      await expect(waiting).not.toHaveAttribute('disabled')
      await waiting.focus()
      await expect(waiting).toBeFocused()
      const submit = sheet.getByRole('button', { name: 'Add to the catalogue' })
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
    await expect(page).toHaveURL(/\/purchases\/manual\/add$/)
    await expect(field(page)).toHaveValue(word)
  })
})

test.describe('nothing close found (MOL-46)', () => {
  test('says «nothing found» above a row two edits away, and offers «Suggest an item» first', async ({
    page,
  }) => {
    await arrive(page)
    const name = nonsense()
    await propose(page, { name, defaultUnit: 'piece' })
    await page.goto('/purchases/manual/add')
    // Two vowels swapped for another, inside the word: two edits, the budget and only just. Vowels,
    // because each is one letter of the key — a consonant may be two (`ch`, `sh`).
    const other = (vowel: string) => (vowel === 'у' ? 'а' : 'у')
    const typo =
      name.slice(0, 3) +
      other(name.charAt(3)) +
      name.slice(4, 7) +
      other(name.charAt(7)) +
      name.slice(8)

    await field(page).fill(typo)

    // The card's own words, not the live region, which says the same (MOL-64).
    await expect(page.locator('.far-title')).toHaveText(`Nothing found for «${typo}»`)
    await expect(options(page).first()).toContainText(name)
    // The list is named by its heading; the live region says «…with a similar spelling» too, and
    // `getByText` would hold only while `exact` happened to tell them apart (MOL-64).
    await expect(page.getByRole('group', { name: 'Similar spelling' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Suggest an item' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Not here? Suggest an item' })).toHaveCount(0)

    // The word itself is a find: everything goes back to how a find looks.
    await field(page).fill(name)
    await expect(options(page).first()).toContainText(name)
    await expect(page.locator('.far')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Not here? Suggest an item' })).toBeVisible()
  })
})

// A state is taken by its heading: `ScreenState` hands «title. body» to the app's live region
// as well, so `getByText` matches the announcement too and strict mode rightly refuses (MOL-64).
test.describe('without the server', () => {
  test('offline: says so without red, searches the recent items, and comes back by itself', async ({
    page,
    context,
  }) => {
    await withKvirta(page, { recent: true })
    await expect(options(page)).toHaveText([new RegExp(KVIRTA_MILK.name)])

    await context.setOffline(true)
    await field(page).fill('квирт')

    // One strip under the field (Ф-14): its own words, not the live region's copy of them.
    const strip = page.locator('.strip.offline')
    await expect(strip).toHaveText(OFFLINE_STRIP)
    await expect(page.locator('.tone-bad, .strip.unanswered')).toHaveCount(0)
    const fieldBox = await field(page).boundingBox()
    const stripBox = await strip.boundingBox()
    expect(stripBox!.y).toBeGreaterThan(fieldBox!.y + fieldBox!.height)
    await expect(options(page)).toHaveText([new RegExp(KVIRTA_MILK.name)])

    await field(page).fill('кефир')
    await expect(options(page)).toHaveCount(0)

    const searches: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/catalogue/search')) searches.push(request.url())
    })
    await context.setOffline(false)

    // Среди строк, а не первой: справочник разработки общий и копится, а проверяется здесь то,
    // что поиск сам ушёл на сервер, когда связь вернулась, — не порядок выдачи.
    await expect(options(page).filter({ hasText: KVIRTA_KEFIR.name })).toHaveCount(1)
    expect(searches.length).toBeGreaterThan(0)
    await expect(strip).toHaveCount(0)
  })

  test('an error offers «Try again» and the recent items', async ({ page }) => {
    await page.setViewportSize(OWNER_IPHONE)
    await withKvirta(page, { recent: true })
    await page.route('**/api/catalogue/search**', (route) => route.abort())

    await field(page).fill('квирта')

    await expect(
      page.getByRole('heading', { name: 'The server did not answer', exact: true }),
    ).toBeVisible()
    // It comes while the person types: the buttons stand under the words, above where the keys of a
    // phone would be, never in the strip at the bottom (owner's В-20 «а»).
    await aboveTheKeys(page.getByRole('button', { name: 'Try again' }))
    await aboveTheKeys(page.getByRole('button', { name: 'Pick from recent' }))
    await page.getByRole('button', { name: 'Pick from recent' }).click()
    await expect(options(page)).toHaveText([new RegExp(KVIRTA_MILK.name)])

    await page.unroute('**/api/catalogue/search**')
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(options(page).first()).toContainText('Квирта')
  })

  // In the owner's language the words are longer, and the pair still stands above the keys side by side.
  test.describe('in Russian', () => {
    test.use({ locale: 'ru-RU' })

    /** The error with a recent item to take, on a window of the given width. */
    async function errorInRussian(page: Page, width: number): Promise<void> {
      await page.setViewportSize({ width, height: OWNER_IPHONE.height })
      const actor = await arrive(page)
      const milk: unknown = await (await propose(page, KVIRTA_MILK)).json()
      await page.evaluate(
        ([key, cards]) => {
          localStorage.setItem(key, cards)
        },
        [`molvia.recent.${actor}`, JSON.stringify([milk])] as const,
      )
      await page.goto('/purchases/manual/add')
      await page.route('**/api/catalogue/search**', (route) => route.abort())
      await page.getByRole('combobox').fill('квирта')
      await expect(
        page.getByRole('heading', { name: 'Сервер не ответил', exact: true }),
      ).toBeVisible()
    }

    const retry = (page: Page) => page.getByRole('button', { name: 'Повторить', exact: true })
    const recent = (page: Page) =>
      page.getByRole('button', { name: 'Взять из недавних', exact: true })

    test('«Повторить» and «Взять из недавних» stand above the keys', async ({ page }) => {
      await errorInRussian(page, OWNER_IPHONE.width)
      await aboveTheKeys(retry(page))
      await aboveTheKeys(recent(page))
    })

    // Every iPhone of 375 and a phone of 360: the pair stays side by side — one under the other it went
    // 52 px lower, under the keys (adversarial А8). A phone of 320 has them one under the other, a price.
    for (const width of [375, 360]) {
      test(`the pair stays side by side at ${String(width)}`, async ({ page }) => {
        await errorInRussian(page, width)
        await settled(retry(page))
        // Both in one reading, so no frame of the page falls between them.
        const [a, b] = await page.evaluate(() =>
          ['Повторить', 'Взять из недавних'].map((word) => {
            const button = [...document.querySelectorAll('.state .action button')].find(
              (one) => one.textContent.trim() === word,
            )
            const box = button!.getBoundingClientRect()
            return { x: box.x, y: box.y, width: box.width, height: box.height }
          }),
        )
        expect(Math.abs(b!.y + b!.height / 2 - (a!.y + a!.height / 2))).toBeLessThan(1)
        expect(b!.x).toBeGreaterThan(a!.x + a!.width)
        expect(b!.x + b!.width).toBeLessThanOrEqual(width - 16)
      })
    }

    // Android's text scale grows the words, not the window: a button wider than the column shrinks and
    // wraps its words, and nothing stands past the screen (self-review №7).
    test('nothing stands past a screen of 320 with the text at 150 %', async ({ page }) => {
      await errorInRussian(page, 320)
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '150%'
      })
      await expect(retry(page)).toBeVisible()
      const wide = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(wide).toBeLessThanOrEqual(320)
      for (const button of await page.locator('.state .action button').all()) {
        const box = await button.boundingBox()
        expect(box!.x + box!.width).toBeLessThanOrEqual(320 - 16 + 0.5)
      }
    })
  })

  test('the skeleton does not pulse for someone who asked for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await withKvirta(page)
    await page.route('**/api/catalogue/search**', () => {
      // Never answered: the skeleton stays for the check.
    })

    await field(page).fill('квирта')

    // The breath is the bar's own colour (MOL-178): read where it is set, or the check passes anyway.
    const bar = page.locator('.loading .bar').first()
    await expect(bar).toBeVisible()
    expect(await bar.evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
  })
})

test.describe('«Bought here last time» (MOL-209)', () => {
  /** A record at `place` with `items` in it, through the API as the queue sends it. */
  async function record(page: Page, place: string, itemIds: readonly string[]): Promise<string> {
    const headers = await asBrowser(page)
    const context = settingsOf(
      actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json()),
    )
    const id = randomUUID()
    const started = await page.request.post('/api/trips', {
      headers,
      data: { context, id, place: { name: place, kind: 'store' } },
    })
    expect(started.status()).toBe(201)
    for (const itemId of itemIds) {
      const added = await page.request.post(`/api/trips/${id}/expenses`, {
        headers,
        data: { id: randomUUID(), itemId },
      })
      expect(added.status()).toBe(201)
    }
    return id
  }

  async function finish(page: Page, id: string): Promise<void> {
    const finished = await page.request.post(`/api/trips/${id}/finish`, {
      headers: await asBrowser(page),
      data: {},
    })
    expect(finished.status()).toBe(204)
  }

  async function item(page: Page, name: string): Promise<string> {
    const response = await propose(page, { name, defaultUnit: 'piece' })
    return ((await response.json()) as { id: string }).id
  }

  const group = (page: Page, name: string) => page.getByRole('group', { name, exact: true })

  /** «+ Позиция» on the record, as a person gets to the search; the answer of the group waited for. */
  async function search(page: Page): Promise<void> {
    await open(page, '/purchases/manual')
    const answered = page.waitForResponse((response) => response.url().endsWith('/previous-items'))
    await page.getByRole('button', { name: 'Add an Item', exact: true }).click()
    expect((await answered).status()).toBe(200)
  }

  test('the last record at the place stands first, without what this one already holds', async ({
    page,
  }) => {
    await arrive(page)
    const word = nonsense()
    const shop = `Магазин ${word}`
    const bread = `Хлеб ${word}`
    const milk = `Молоко ${word}`
    const [breadId, milkId] = [await item(page, bread), await item(page, milk)]

    await finish(page, await record(page, shop, [milkId, breadId]))
    // The next record at the same shop, the milk already in it.
    await record(page, shop, [milkId])
    await search(page)

    const here = group(page, 'Bought here last time')
    await expect(here.getByRole('option')).toHaveText([new RegExp(bread)])
    await expect(page.getByRole('option', { name: new RegExp(milk) })).toHaveCount(0)

    // Typed, the group is the empty field's no more: the search answers.
    await field(page).fill(bread)
    await expect(group(page, 'Found').getByRole('option').first()).toContainText(bread)
    await expect(here).toHaveCount(0)
  })

  test('another shop has its own last time — none here', async ({ page }) => {
    await arrive(page)
    const word = nonsense()
    const cheese = await item(page, `Сыр ${word}`)
    await finish(page, await record(page, `Магазин ${word}`, [cheese]))
    await record(page, `Другой ${word}`, [])
    await search(page)

    await expect(field(page)).toBeVisible()
    await expect(group(page, 'Bought here last time')).toHaveCount(0)
  })
})
