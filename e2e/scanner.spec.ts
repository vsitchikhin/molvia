/// <reference lib="dom" />
// DOM for the init script, which runs in the browser.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { BARCODE } from './barcode-video'
import { open } from './session'

/**
 * The scanner in a real Chromium with a camera that films a barcode (MOL-98) — what the
 * component tests cannot show: the stream on the video, the frame cut from it, the worker and its
 * wasm reading it, and the wasm coming from the app itself. On the kit page, until a screen opens
 * the scanner (MOL-99).
 */

const openScanner = (page: Page) => page.getByRole('button', { name: 'Scan a barcode' }).click()
const scanned = (page: Page, code: string) => page.getByText(`Read: ${code}`, { exact: true })
const scanner = (page: Page) => page.getByRole('dialog', { name: 'Barcode' })

test('reads the barcode the camera films, with the reader from the app’s own origin', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['camera'])
  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await open(page, '/_kit')

  await openScanner(page)

  // The first run compiles the wasm; a second of reading comes on top on a slow stand.
  await expect(scanned(page, BARCODE)).toBeVisible({ timeout: 15_000 })
  await expect(scanner(page)).toBeHidden()
  expect(requested.some((url) => /zxing_reader.*\.wasm/.test(url))).toBe(true)
  expect(requested.filter((url) => !url.startsWith(new URL(page.url()).origin))).toEqual([])
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
