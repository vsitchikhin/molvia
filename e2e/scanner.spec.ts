/// <reference lib="dom" />
// DOM for the init script, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { BARCODE } from './barcode-video'
import { asBrowser, open } from './session'

/**
 * The scanner in a real Chromium with a camera that films a barcode (MOL-98) — what the
 * component tests cannot show: the stream on the video, the frame cut from it, the worker and its
 * wasm reading it, and the wasm coming from the app itself. On the kit page, and on «What did you
 * pick up?», where MOL-99 put it.
 */

const scanButton = (page: Page) => page.getByRole('button', { name: 'Scan a barcode' })

/**
 * Opens the scanner and waits for its sheet to be up: until it has risen it takes no tap at all
 * (MOL-69), and a refusal is drawn at once — on a loaded machine a tap on «Type it in» landed while
 * the sheet still rose and went nowhere. Its rise, then the double-tap floor it never goes under.
 */
async function openScanner(page: Page): Promise<void> {
  await scanButton(page).click()
  await page
    .locator('dialog[open]')
    .evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
  await page.waitForTimeout(350)
}

// Reading waits long: the first read compiles the 931 KB wasm, and with a Chromium per worker and a
// loaded machine that took up to 27 s (measured 29.09.2026, five in parallel), 8 s alone. The test
// that reads gets the time on top of its own.
const READ = 30_000
const scanned = (page: Page, code: string) => page.getByText(`Read: ${code}`, { exact: true })
const scanner = (page: Page) => page.getByRole('dialog', { name: 'Barcode' })

test('reads the barcode the camera films, with the reader from the app’s own origin', async ({
  page,
  context,
}) => {
  test.setTimeout(READ * 2)
  await context.grantPermissions(['camera'])
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await open(page, '/_kit')

  await openScanner(page)

  await expect(scanned(page, BARCODE)).toBeVisible({ timeout: READ })
  await expect(scanner(page)).toBeHidden()
  expect(requested.some((url) => /zxing_reader.*\.wasm/.test(url))).toBe(true)
  expect(requested.filter((url) => !url.startsWith(new URL(page.url()).origin))).toEqual([])
})

// Every track the page was given, to ask later whether one still runs.
async function recordTracks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tracks: MediaStreamTrack[] = []
    ;(window as unknown as { tracks: MediaStreamTrack[] }).tracks = tracks
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints)
      tracks.push(...stream.getTracks())
      return stream
    }
  })
}
const liveTracks = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { tracks: MediaStreamTrack[] }).tracks.filter(
        (track) => track.readyState === 'live',
      ).length,
  )
const WASM = /zxing_reader.*\.wasm/

test('a reader that will not load says so, and leaves no camera running (adversarial В)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['camera'])
  await recordTracks(page)
  await page.route(WASM, (route) => route.abort())
  await open(page, '/_kit')
  await openScanner(page)

  await expect(page.getByRole('heading', { name: 'The scanner is not responding' })).toBeVisible()
  await expect.poll(() => liveTracks(page)).toBe(0)
})

test('allowed after a refusal while the reader still loads, «Check again» reads the code (adversarial Б)', async ({
  page,
  context,
}) => {
  test.setTimeout(READ * 2)
  // A slow network on a first visit: the reader arrives seconds after the tap.
  await page.route(WASM, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    await route.continue().catch(() => undefined)
  })
  await open(page, '/_kit')
  await openScanner(page)
  await expect(page.getByRole('heading', { name: 'No access to the camera' })).toBeVisible()

  await context.grantPermissions(['camera'])
  await scanner(page).getByRole('button', { name: 'Check again' }).click()

  await expect(scanned(page, BARCODE)).toBeVisible({ timeout: READ })
})

test('says how to allow the camera when it is not allowed', async ({ page }) => {
  await open(page, '/_kit')
  await openScanner(page)

  await expect(page.getByRole('heading', { name: 'No access to the camera' })).toBeVisible()
  await expect(scanner(page).getByRole('button', { name: 'Check again' })).toBeVisible()
})

test.describe('with no camera', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('no camera', 'NotFoundError'))
    })
    await open(page, '/_kit')
    await openScanner(page)
    await expect(page.getByRole('heading', { name: 'No camera' })).toBeVisible()
    await scanner(page).getByRole('button', { name: 'Type it in' }).click()
  })

  test('takes the digits typed by hand', async ({ page }) => {
    await scanner(page)
      .getByLabel('Digits under the barcode')
      .fill(`${BARCODE.slice(0, 1)} ${BARCODE.slice(1)}`)
    await scanner(page).getByRole('button', { name: 'Done' }).click()

    await expect(scanned(page, BARCODE)).toBeVisible()
    await expect(scanner(page)).toBeHidden()
  })

  test('refuses digits that do not check, and keeps the sheet', async ({ page }) => {
    await scanner(page).getByLabel('Digits under the barcode').fill('4850000000003')
    await scanner(page).getByLabel('Digits under the barcode').press('Enter')

    await expect(scanner(page).getByText("The digits don't add up — check the code")).toBeVisible()
    await expect(scanner(page)).toBeVisible()
  })
})

/**
 * «What did you pick up?» (MOL-99). The camera's code is never written here: the catalogue is shared
 * by every spec of the run, and a code written would be found where these expect nobody to hold it —
 * a code is written by hand, one of its own per test (MOL-100, below).
 */
test.describe('on «What did you pick up?»', () => {
  // The block on the screen, not the app's live region, which says the same words (MOL-19).
  const missing = (page: Page) =>
    page
      .locator('.not-found')
      .getByText(`The catalogue does not know the code ${BARCODE}`, { exact: true })

  test('a code the camera read and nobody holds offers «Suggest an item»', async ({
    page,
    context,
  }) => {
    test.setTimeout(READ * 2)
    await context.grantPermissions(['camera'])
    await open(page, '/purchases/manual/add')

    // Nothing is tapped in the sheet, so its rise is not waited for: a camera that reads at once
    // closed the sheet before the rise was over, and the wait for an open dialog never ended.
    await page.getByRole('button', { name: 'Scan a barcode' }).click()

    await expect(missing(page)).toBeVisible({ timeout: READ })
    await expect(page.locator('.announcer')).toContainText(
      `The catalogue does not know the code ${BARCODE}`,
    )
    await expect(scanner(page)).toBeHidden()
    await expect(page.getByRole('button', { name: 'Suggest an item' })).toBeVisible()
  })

  test('a code typed by hand is looked up the same way, and typing gives the search back', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('no camera', 'NotFoundError'))
    })
    await open(page, '/purchases/manual/add')
    await openScanner(page)
    await scanner(page).getByRole('button', { name: 'Type it in' }).click()
    await scanner(page).getByLabel('Digits under the barcode').fill(BARCODE)
    await scanner(page).getByRole('button', { name: 'Done' }).click()

    await expect(missing(page)).toBeVisible()

    await page.getByRole('combobox', { name: 'What did you pick up?' }).fill('молоко')
    await expect(missing(page)).toBeHidden()
  })
})

/**
 * A code written and found again (MOL-100): proposed with its item, or linked to one found by name —
 * and let go of by «not this item?». Typed by hand, a code of its own per test: the catalogue is
 * shared by the whole run, and the camera films one code for everybody.
 */
test.describe('a code written to the catalogue (MOL-100)', () => {
  /** Twelve digits of our own and the check digit a write demands (Р-1). */
  /** A code nobody holds; led by `46`, one the fake of Open Food Facts knows (MOL-162). */
  function freshCode(lead = '48'): string {
    const body = `${lead}${String(randomInt(10 ** 9)).padStart(10, '0')}`
    let sum = 0
    for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = 4 - weight) {
      sum += Number(body[i]) * weight
    }
    return `${body}${String((10 - (sum % 10)) % 10)}`
  }

  const tag = String(randomInt(10 ** 6))
  const missingOf = (page: Page, code: string) =>
    page
      .locator('.not-found')
      .getByText(`The catalogue does not know the code ${code}`, { exact: true })

  async function typeCode(page: Page, code: string): Promise<void> {
    await openScanner(page)
    await scanner(page).getByRole('button', { name: 'Type it in' }).click()
    await scanner(page).getByLabel('Digits under the barcode').fill(code)
    await scanner(page).getByRole('button', { name: 'Done' }).click()
  }

  /** The purchase sheet of an item, up and risen, then put away with ×. */
  async function sheetOf(page: Page, name: string): Promise<Locator> {
    const details = page.getByRole('dialog', { name })
    await expect(details).toBeVisible()
    await page.waitForTimeout(400)
    return details
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('no camera', 'NotFoundError'))
    })
  })

  test('a shop’s own label is said to be one, and nothing is offered to link (В-4)', async ({
    page,
  }) => {
    await open(page, '/purchases/manual/add')

    await typeCode(page, '20000011')

    await expect(
      page.locator('.not-found').getByText("Code 20000011 is a shop's own label", { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Suggest an item' })).toHaveCount(0)
  })

  test('proposed with its item under «unknown», the code finds the item on the next scan', async ({
    page,
  }) => {
    const code = freshCode()
    const name = `Сметана ${tag}`
    await open(page, '/purchases/manual/add')
    await typeCode(page, code)
    await expect(missingOf(page, code)).toBeVisible()

    await page.getByRole('button', { name: 'Suggest an item' }).click()
    const form = page.getByRole('dialog', { name: 'New item' })
    await expect(form.getByText(`Code ${code} will be saved with the item`)).toBeVisible()
    await form.getByLabel('As the price tag says').fill(name)
    const kilo = form.getByRole('radio', { name: 'kg', exact: true })
    await expect(async () => {
      await form.getByText('kg', { exact: true }).click()
      await expect(kilo).toBeChecked({ timeout: 200 })
    }).toPass({ timeout: 5000 })
    await form.getByRole('button', { name: 'Add to the catalogue' }).click()

    const first = await sheetOf(page, name)
    await first.getByRole('button', { name: 'Close' }).click()
    await expect(first).toBeHidden()

    await typeCode(page, code)
    await sheetOf(page, name)
  })

  test('a code Open Food Facts knows: the hint under «unknown», the form filled, the purchase at the size of the pack (MOL-162)', async ({
    page,
  }) => {
    const code = freshCode('46')
    const name = `Тушёнка ${code.slice(-6)} Главпродукт`
    await open(page, '/purchases/manual/add')
    await typeCode(page, code)
    await expect(missingOf(page, code)).toBeVisible()

    await expect(
      page.locator('.not-found').getByText(`Looks like “${name}”, 0.325 kg`),
    ).toBeVisible()
    await expect(page.locator('.announcer')).toContainText(`Looks like “${name}”, 0.325 kg`)

    await page.getByRole('button', { name: 'Suggest an item' }).click()
    const form = page.getByRole('dialog', { name: 'New item' })
    await expect(form.getByLabel('As the price tag says')).toHaveValue(name)
    await expect(form.getByRole('radio', { name: 'kg', exact: true })).toBeChecked()
    await expect(form.getByText('0.325 kg in the pack')).toBeVisible()
    await expect(form.getByRole('link', { name: 'Data from Open Food Facts ↗' })).toHaveAttribute(
      'href',
      `https://world.openfoodfacts.org/product/${code}`,
    )
    await page.waitForTimeout(400)
    await form.getByRole('button', { name: 'Add to the catalogue' }).click()

    const details = await sheetOf(page, name)
    await expect(details.getByLabel('How much')).toHaveValue('0.325')
  })

  test('a code Open Food Facts does not know: «unknown» as it was, with no hint (MOL-162)', async ({
    page,
  }) => {
    const code = freshCode()
    await open(page, '/purchases/manual/add')
    // Waited for by its answer, not by a clock: under load the hint lands later than any timeout
    // (review 4).
    const answered = page.waitForResponse(/\/api\/catalogue\/barcode\/hint\?/)
    await typeCode(page, code)

    await expect(missingOf(page, code)).toBeVisible()
    expect(await (await answered).json()).toEqual({ hint: null })
    await expect(page.locator('.code-hint')).toHaveCount(0)
  })

  /** Holds every hint until `release()`, then lets each go on to the API; `answered` waits for one. */
  async function holdHints(page: Page) {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/catalogue/barcode/hint?*', async (route) => {
      await gate
      await route.continue()
    })
    return { release, answered: () => page.waitForResponse(/\/api\/catalogue\/barcode\/hint\?/) }
  }

  test('the hint comes under «Suggest an item», which stays where the thumb saw it (MOL-162, В-5, adversarial Г)', async ({
    page,
  }) => {
    const code = freshCode('46')
    const hints = await holdHints(page)
    await open(page, '/purchases/manual/add')
    await typeCode(page, code)
    await expect(missingOf(page, code)).toBeVisible()
    const suggest = page.getByRole('button', { name: 'Suggest an item' })
    await page.waitForTimeout(400)
    const before = await suggest.boundingBox()

    hints.release()
    await expect(page.locator('.code-hint')).toBeVisible()
    await page.waitForTimeout(400)

    expect(await suggest.boundingBox()).toEqual(before)
  })

  test('a hint that comes after «Suggest an item» opened leaves the form as it opened (MOL-162, adversarial Д)', async ({
    page,
  }) => {
    const code = freshCode('46')
    const hints = await holdHints(page)
    await open(page, '/purchases/manual/add')
    await typeCode(page, code)
    await expect(missingOf(page, code)).toBeVisible()
    await page.getByRole('button', { name: 'Suggest an item' }).click()
    const form = page.getByRole('dialog', { name: 'New item' })
    const name = form.getByLabel('As the price tag says')
    await expect(name).toHaveValue('')
    await page.waitForTimeout(400)
    const before = await name.boundingBox()

    const answered = hints.answered()
    hints.release()
    expect(await (await answered).json()).toMatchObject({ hint: { name: expect.any(String) } })
    await page.waitForTimeout(400)

    await expect(name).toHaveValue('')
    expect(await name.boundingBox()).toEqual(before)
    await expect(form.getByRole('radio', { name: 'kg', exact: true })).not.toBeChecked()
    await expect(form.getByRole('link', { name: 'Data from Open Food Facts ↗' })).toHaveCount(0)
  })

  test('linked to an item found by name, it finds the item — until «not this item?» lets it go', async ({
    page,
  }) => {
    const code = freshCode()
    const name = `Кефир ${tag}`
    await open(page, '/purchases/manual/add')
    const created = await page.request.post('/api/catalogue/items', {
      headers: await asBrowser(page),
      data: { kind: 'product', name, defaultUnit: 'l' },
    })
    expect(created.status()).toBe(201)

    await typeCode(page, code)
    await expect(missingOf(page, code)).toBeVisible()
    await page.getByRole('combobox', { name: 'What did you pick up?' }).fill(name)
    await expect(
      page.getByText(`Code ${code} is waiting for its item — pick it in the list`),
    ).toBeVisible()
    await page.getByRole('option', { name: new RegExp(name) }).click()
    await expect(
      page.locator('.not-found').getByText(`Link code ${code} to «${name}»?`),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Link and record' }).click()

    const linked = await sheetOf(page, name)
    await linked.getByRole('button', { name: 'Close' }).click()
    await expect(linked).toBeHidden()

    await typeCode(page, code)
    const found = await sheetOf(page, name)
    await found.getByRole('button', { name: `Code ${code} — not this item?` }).click()
    await expect(found.getByText(`Unlink code ${code} from «${name}»?`)).toBeVisible()
    await found.getByRole('button', { name: 'Unlink', exact: true }).click()

    await expect(found).toBeHidden()
    await expect(missingOf(page, code)).toBeVisible()
  })

  /**
   * Where the focus goes as the code's blocks replace one another (adversarial О, О′): each block
   * takes away the button that held it, and left alone the focus fell to the body — outside the
   * modal sheet where there was one. Keyboard and screen reader only; the finger does not see it.
   */
  test.describe('the focus through the code’s blocks', () => {
    const LINKS = '**/api/catalogue/items/*/barcodes'
    const LINK = /\/api\/catalogue\/items\/[^/]+\/barcodes$/

    const focused = (page: Page) =>
      page.evaluate(() => ({
        body: document.activeElement === null || document.activeElement === document.body,
        inSheet: document.querySelector('dialog[open]')?.contains(document.activeElement) ?? null,
        text: document.activeElement?.textContent.trim() ?? '',
        field: document.activeElement?.getAttribute('role') === 'combobox',
      }))

    async function anItem(page: Page, name: string, barcodes: string[] = []): Promise<string> {
      const created = await page.request.post('/api/catalogue/items', {
        headers: await asBrowser(page),
        data: { kind: 'product', name, defaultUnit: 'l', barcodes },
      })
      expect(created.status()).toBe(201)
      return ((await created.json()) as { id: string }).id
    }

    /**
     * A miss, the item's name typed, its row tapped: the question, the focus on «Link and record».
     *
     * The link's answer is laid before the page opens (MOL-249): laid on the open page right before
     * Enter, a link once reached the server, and the screen went on to the purchase sheet. Nothing is
     * linked before the test's own Enter — a link sent earlier is said so here, not as a lost focus.
     */
    async function asked(
      page: Page,
      name: string,
      code: string,
      link?: (route: Route) => Promise<void>,
    ): Promise<void> {
      if (link) await page.route(LINKS, link)
      const linked: string[] = []
      page.on('request', (request) => {
        if (request.method() === 'POST' && LINK.test(new URL(request.url()).pathname)) {
          linked.push(request.url())
        }
      })
      await open(page, '/purchases/manual/add')
      await anItem(page, name)
      await typeCode(page, code)
      await expect(missingOf(page, code)).toBeVisible()
      await page.getByRole('combobox', { name: 'What did you pick up?' }).fill(name)
      await page.getByRole('option', { name: new RegExp(name) }).click()
      await expect(
        page.locator('.not-found').getByText(`Link code ${code} to «${name}»?`),
      ).toBeVisible()
      await expect.poll(async () => (await focused(page)).text).toBe('Link and record')
      expect(linked, 'nothing is linked before Enter').toEqual([])
    }

    test('a miss, a shop’s label: the scanner hands the focus back, never to the body', async ({
      page,
    }) => {
      await open(page, '/purchases/manual/add')
      await typeCode(page, freshCode())
      await expect(page.locator('.not-found')).toBeVisible()
      await expect.poll(async () => (await focused(page)).body).toBe(false)

      await typeCode(page, '20000011')
      // The block on the screen, not the live region, which says the same words (`e2e.md`): on a
      // loaded machine both are there at once.
      await expect(
        page.locator('.bind-question').getByText("Code 20000011 is a shop's own label"),
      ).toBeVisible()
      await expect.poll(async () => (await focused(page)).body).toBe(false)
    })

    test('✕ of «waiting for its item» gives the focus to the field', async ({ page }) => {
      const code = freshCode()
      await open(page, '/purchases/manual/add')
      await typeCode(page, code)
      await expect(missingOf(page, code)).toBeVisible()
      await page.getByRole('combobox', { name: 'What did you pick up?' }).fill(`Кефир ${tag}`)

      await page.getByRole('button', { name: "Don't link the code" }).click()

      await expect.poll(async () => (await focused(page)).field).toBe(true)
    })

    test('an error and «Try again»: the focus on the error’s button, then on the bind button, «Linking…», until it lands', async ({
      page,
    }) => {
      const code = freshCode()
      const name = `Кефир ${tag} ф1`
      let calls = 0
      await asked(page, name, code, async (route) => {
        calls += 1
        if (calls === 1) return route.fulfill({ status: 502, body: 'Bad Gateway' })
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return route.continue()
      })

      await page.keyboard.press('Enter')
      // The state on the screen, not the live region, which says the same words (`e2e.md`).
      await expect(
        page
          .locator('.state')
          .getByText(`Could not link code ${code}. Try again — or record without the code`),
      ).toBeVisible()
      await expect.poll(async () => (await focused(page)).text).toBe('Try again')

      await page.keyboard.press('Enter')
      // The button at work says so in its own word (MOL-225), the focus still on it until it lands.
      await expect.poll(async () => (await focused(page)).text).toBe('Linking…')
      await expect(page.getByRole('dialog', { name })).toBeVisible()
    })

    test('offline: the focus on the offline block’s «Try again»', async ({ page, context }) => {
      const code = freshCode()
      await asked(page, `Кефир ${tag} ф2`, code)
      await context.setOffline(true)

      await page.keyboard.press('Enter')

      // By its block: the live region says the same words (e2e.md, MOL-64).
      await expect(
        page
          .locator('.state')
          .getByText(
            'The code is not linked. Try again with a connection — or record without the code',
          ),
      ).toBeVisible()
      await expect.poll(async () => (await focused(page)).text).toBe('Try again')
      await context.setOffline(false)
    })

    test('an item full of codes: the focus on «Record … without the code»', async ({ page }) => {
      const code = freshCode()
      const name = `Кефир ${tag} ф3`
      await asked(page, name, code, (route) =>
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'error.barcodes_full' }),
        }),
      )

      await page.keyboard.press('Enter')

      await expect
        .poll(async () => (await focused(page)).text)
        .toBe(`Record «${name}» without the code`)
    })

    test('«This code already belongs to …» in «Suggest an item»: the focus stays in the sheet, on «Take …»', async ({
      page,
    }) => {
      const code = freshCode()
      const holder = `Ряженка ${tag}`
      await open(page, '/purchases/manual/add')
      await typeCode(page, code)
      await expect(missingOf(page, code)).toBeVisible()
      await anItem(page, holder, [code])
      await page.getByRole('button', { name: 'Suggest an item' }).click()
      const form = page.getByRole('dialog', { name: 'New item' })
      await expect(form).toBeVisible()
      await page.waitForTimeout(400)
      await form.getByLabel('As the price tag says').fill(`Варенец ${tag}`)
      const kilo = form.getByRole('radio', { name: 'kg', exact: true })
      await expect(async () => {
        await form.getByText('kg', { exact: true }).click()
        await expect(kilo).toBeChecked({ timeout: 200 })
      }).toPass({ timeout: 5000 })
      await form.getByRole('button', { name: 'Add to the catalogue' }).focus()

      await page.keyboard.press('Enter')

      await expect(form.getByText(`This code already belongs to «${holder}»`)).toBeVisible()
      await expect
        .poll(async () => focused(page))
        .toMatchObject({
          inSheet: true,
          text: `Take «${holder}»`,
        })
    })

    test('an answer that opens the purchase sheet: closed, the sheet leaves the focus on the page, never the body (Ф)', async ({
      page,
    }) => {
      const code = freshCode()
      const name = `Кефир ${tag} ф5`
      await asked(page, name, code)

      await page.getByRole('button', { name: 'Record without the code' }).click()
      const sheet = await sheetOf(page, name)
      await page.keyboard.press('Escape')

      await expect(sheet).toBeHidden()
      await expect.poll(async () => (await focused(page)).body).toBe(false)
    })

    test('«Suggest an item» under «does not know the code», sent: the purchase sheet closed leaves the focus on the page (Ф′)', async ({
      page,
    }) => {
      const code = freshCode()
      const name = `Варенец ${tag} ф6`
      await open(page, '/purchases/manual/add')
      await typeCode(page, code)
      await expect(missingOf(page, code)).toBeVisible()
      await page.getByRole('button', { name: 'Suggest an item' }).click()
      const form = page.getByRole('dialog', { name: 'New item' })
      await expect(form).toBeVisible()
      await page.waitForTimeout(400)
      await form.getByLabel('As the price tag says').fill(name)
      const kilo = form.getByRole('radio', { name: 'kg', exact: true })
      await expect(async () => {
        await form.getByText('kg', { exact: true }).click()
        await expect(kilo).toBeChecked({ timeout: 200 })
      }).toPass({ timeout: 5000 })
      await form.getByRole('button', { name: 'Add to the catalogue' }).click()

      const sheet = await sheetOf(page, name)
      await page.keyboard.press('Escape')

      await expect(sheet).toBeHidden()
      await expect.poll(async () => (await focused(page)).body).toBe(false)
    })

    test('«Unlink?»: the focus on «Cancel», back on «not this item?», and after the unlink never the body', async ({
      page,
    }) => {
      const code = freshCode()
      const name = `Кефир ${tag} ф4`
      await open(page, '/purchases/manual/add')
      await anItem(page, name, [code])
      await typeCode(page, code)
      const found = await sheetOf(page, name)
      const notThis = found.getByRole('button', { name: `Code ${code} — not this item?` })

      await notThis.click()
      await expect.poll(async () => (await focused(page)).text).toBe('Cancel')
      await page.keyboard.press('Enter')
      await expect
        .poll(async () => focused(page))
        .toMatchObject({
          inSheet: true,
          text: `Code ${code} — not this item?`,
        })

      await notThis.click()
      await found.getByRole('button', { name: 'Unlink', exact: true }).click()
      await expect(found).toBeHidden()
      await expect(missingOf(page, code)).toBeVisible()
      await expect.poll(async () => (await focused(page)).body).toBe(false)
    })
  })
})

/**
 * «Scan a barcode» on the record (MOL-99, В-4, review С-4): the search opens with the scanner up
 * over it, with no tap of its own there — the entry the sheet lays rides on the tap on the record.
 * «Back» takes the scanner away and leaves the search by name; «back» again is the record.
 */
test('«Scan a barcode» on the record: the scanner is up at once, and «back» walks out one step at a time', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('no camera', 'NotFoundError'))
  })
  await open(page, '/')
  await page.getByRole('button', { name: 'Add by hand' }).click()
  const where = page.locator('dialog[open]')
  await expect(where).toContainText('Where are you?')
  await page.waitForTimeout(400)
  await where.getByLabel('Another place').fill('Ереван Сити')
  await where.getByRole('button', { name: 'Start the entry' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page).toHaveURL(/\/purchases\/manual$/)

  await page.getByRole('button', { name: 'Scan a barcode' }).click()

  await expect(page).toHaveURL(/\/purchases\/manual\/add$/)
  await expect(scanner(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No camera' })).toBeVisible()

  await page.goBack()
  await expect(scanner(page)).toBeHidden()
  await expect(page).toHaveURL(/\/purchases\/manual\/add$/)
  await expect(page.getByRole('combobox', { name: 'What did you pick up?' })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/purchases\/manual$/)
})

/**
 * What the screen shows inside `target`'s box, darkest to lightest pixel and the mean, 0…255: a
 * barcode is near 255, a flat colour near 0. A screenshot of the page, not of the element — a
 * headless screenshot of a `<video>` alone draws nothing — inside the band, clear of its own border.
 */
async function onScreen(
  page: Page,
  target: Locator,
): Promise<{ spread: number; mean: number } | null> {
  const box = await target.boundingBox()
  const view = page.viewportSize()
  if (!box || !view) return null
  const inset = 10
  const clip = {
    x: box.x + inset,
    y: box.y + inset,
    width: box.width - 2 * inset,
    height: Math.min(box.height - 2 * inset, view.height - box.y - inset),
  }
  if (clip.height < 4) return null
  const picture = await page.screenshot({ clip, animations: 'allow' })
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    context.drawImage(image, 0, 0)
    const { data } = context.getImageData(0, 0, image.width, image.height)
    let low = 255
    let high = 0
    let sum = 0
    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0)
      low = Math.min(low, luma)
      high = Math.max(high, luma)
      sum += luma
    }
    return { spread: high - low, mean: sum / (data.length / 4) }
  }, picture.toString('base64'))
}

/**
 * Adversarial Е″ (MOL-99): a stopped track leaves a `<video>` black in Chromium, stream on it or
 * not — so the last frame is drawn before the camera stops, and the sheet slides down with it. What
 * the eye gets is measured: the slide slowed to 3 s and held still for the screenshot, the reading
 * band compared with itself while open.
 */
test('slides down with the barcode it read still on the screen, not black', async ({
  page,
  context,
}) => {
  test.setTimeout(READ * 2)
  await context.grantPermissions(['camera'])
  // The reader held back until the live picture is measured: warm, it reads before a frame can be.
  let letReaderIn!: () => void
  const readerHeld = new Promise<void>((resolve) => (letReaderIn = resolve))
  await page.route(/zxing_reader.*\.wasm/, async (route) => {
    await readerHeld
    await route.continue()
  })
  await open(page, '/purchases/manual/add')
  await page.addStyleTag({ content: ':root { --dur: 3000ms !important; }' })
  const band = scanner(page).locator('.frame')

  await openScanner(page)
  await expect
    .poll(async () => (await onScreen(page, band))?.spread ?? 0, { timeout: READ })
    .toBeGreaterThan(100)
  letReaderIn()

  // The code read, the sheet closed and sliding down: held where it is for the screenshot.
  const video = page.getByRole('dialog', { name: 'Barcode', includeHidden: true }).locator('video')
  await video.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const dialog = element.closest('dialog')
        const wait = () => {
          if (dialog?.open !== false) {
            requestAnimationFrame(wait)
            return
          }
          requestAnimationFrame(() => {
            for (const animation of dialog.getAnimations()) animation.pause()
            resolve()
          })
        }
        wait()
      }),
    undefined,
    { timeout: READ },
  )
  const leaving = await onScreen(
    page,
    page.getByRole('dialog', { name: 'Barcode', includeHidden: true }).locator('.frame'),
  )

  expect(leaving?.spread).toBeGreaterThan(100)
})

/**
 * Safari on an iPhone (MOL-163): Apple's vendor on a touch screen, and a browser that answers it
 * will ask for the camera — which Safari does once per page load until its setting says «Allow».
 * Chromium is given the camera all the same; only what the page is told is Safari's.
 */
async function asSafari(page: Page, state: PermissionState = 'prompt'): Promise<void> {
  await page.addInitScript((answer) => {
    Object.defineProperty(navigator, 'vendor', { value: 'Apple Computer, Inc.' })
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5 })
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    })
    const query = navigator.permissions.query.bind(navigator.permissions)
    navigator.permissions.query = (descriptor) =>
      descriptor.name === 'camera'
        ? Promise.resolve({ state: answer } as PermissionStatus)
        : query(descriptor)
  }, state)
}
const cameraHint = (page: Page) => page.getByRole('dialog', { name: 'Camera without asking' })

test('tells how to stop Safari asking, once the camera is given, and reads after «Got it»', async ({
  page,
  context,
}) => {
  test.setTimeout(READ * 2)
  await context.grantPermissions(['camera'])
  await asSafari(page)
  await open(page, '/_kit')
  // Not `openScanner`: the hint may rise before the scanner's sheet is waited for, and then two
  // sheets are open.
  await scanButton(page).click()

  // After the camera is live, which a loaded machine takes its time to give.
  await expect(cameraHint(page)).toBeVisible({ timeout: 15_000 })
  await expect(cameraHint(page)).toContainText('The page menu by the address bar')
  // Until it has come up a sheet takes no tap (MOL-69), and on a loaded machine its rise starts a
  // frame late — a tap timed by its animations landed before it and was held. Tapped until it goes.
  await expect(async () => {
    if (await cameraHint(page).isVisible()) {
      await cameraHint(page).getByRole('button', { name: 'Got it' }).click({ timeout: 500 })
    }
    await expect(cameraHint(page)).toBeHidden({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
  await expect(scanned(page, BARCODE)).toBeVisible({ timeout: READ })
})

test('seen on this phone, the hint waits behind a quiet line', async ({ page, context }) => {
  await context.grantPermissions(['camera'])
  await asSafari(page)
  await page.addInitScript(() => {
    localStorage.setItem('molvia.camera-hint', '1')
  })
  // A reader that never arrives keeps the viewfinder up: the code it films would close it.
  await page.route(WASM, () => undefined)
  await open(page, '/_kit')
  await openScanner(page)

  const quiet = scanner(page).getByRole('button', {
    name: 'Safari asks every time? How to stop it',
  })
  await expect(quiet).toBeVisible({ timeout: 15_000 })
  await expect(cameraHint(page)).toBeHidden()
  await quiet.click()
  await expect(cameraHint(page)).toBeVisible()
})

test('says nothing where Safari will not ask — its setting says «Allow»', async ({
  page,
  context,
}) => {
  test.setTimeout(READ * 2)
  await context.grantPermissions(['camera'])
  await asSafari(page, 'granted')
  await open(page, '/_kit')
  // Not `openScanner`: with nothing over it the scanner may read and close before its sheet is
  // waited for.
  await scanButton(page).click()

  await expect(scanned(page, BARCODE)).toBeVisible({ timeout: READ })
  await expect(cameraHint(page)).toBeHidden()
})
