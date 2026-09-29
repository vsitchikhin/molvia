/// <reference lib="dom" />
// DOM for the init script, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BARCODE } from './barcode-video'
import { open } from './session'

/**
 * The scanner in a real Chromium with a camera that films a barcode (MOL-98) — what the
 * component tests cannot show: the stream on the video, the frame cut from it, the worker and its
 * wasm reading it, and the wasm coming from the app itself. On the kit page, and on «What did you
 * pick up?», where MOL-99 put it.
 */

/**
 * Opens the scanner and waits for its sheet to be up: until it has risen it takes no tap at all
 * (MOL-69), and a refusal is drawn at once — on a loaded machine a tap on «Type it in» landed while
 * the sheet still rose and went nowhere. Its rise, then the double-tap floor it never goes under.
 */
async function openScanner(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Scan a barcode' }).click()
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
 * «What did you pick up?» (MOL-99). No code can be written to the catalogue yet — «Suggest an item»
 * takes codes with MOL-100 — so here a code is found by nobody; the item found is held by the
 * integration and component tests until the API can write one.
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

    await openScanner(page)

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
