/// <reference lib="dom" />
// DOM for the init script, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
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
  await page.getByRole('button', { name: 'Record purchases' }).click()
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
