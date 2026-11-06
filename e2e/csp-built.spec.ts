/// <reference lib="dom" />
// DOM for the evaluated functions, which run in the browser.
import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { BARCODE } from './barcode-video'
import { expect, test } from './csp'
import { AGE, ACCEPT } from './session'

// MOL-363, the built app (`pwa-camera` and `pwa-iphone`): the policy is a meta only the build puts in,
// so this is the one place the app runs under it. Every step goes where a directive decides — the
// scripts of `index.html` by their hashes, the bundle and the faces, a worker and its wasm, a photo
// as `blob:` — and `csp.ts` fails it on any violation. It comes in by `page.goto`, not through
// `open()`: the development seam's button is not in a build (pwa-update.spec's reason).

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/** The faces the page asked for have come, and none was refused. */
async function facesCame(page: Page): Promise<void> {
  const faces = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].map((face) => face.status)
  })
  expect(faces).toContain('loaded')
  expect(faces).not.toContain('error')
}

/** A sheet has come up: its rise, then the double-tap floor — until then it takes no tap (MOL-69). */
async function risen(page: Page): Promise<void> {
  await page
    .locator('dialog[open]')
    .last()
    .evaluate((dialog) =>
      Promise.allSettled(dialog.getAnimations().map((animation) => animation.finished)),
    )
  await page.waitForTimeout(350)
}

/** An `<img>` drawn from what it points at, not an empty box a refused `blob:` leaves. */
const drawn = (image: ReturnType<Page['locator']>) =>
  expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0)

test('the meta stands first and names exactly the scripts of index.html', async ({ page }) => {
  const html = await (await page.request.get('/')).text()
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(html)
  expect(meta, 'no policy in the built index.html').not.toBeNull()
  expect(meta?.index ?? Infinity).toBeLessThan(html.indexOf('<script'))
  const scriptSrc = (meta?.[1] ?? '')
    .split('; ')
    .find((directive) => directive.startsWith('script-src '))
  const hashes = scriptSrc?.split(' ').filter((source) => source.startsWith("'sha256-")) ?? []
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) =>
    sha256(body ?? ''),
  )
  expect(inline).toHaveLength(3)
  expect(hashes.toSorted()).toEqual(inline.toSorted())
})

test('a stranger’s screens run under it: the door and «Data and privacy», with their faces', async ({
  page,
}) => {
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await facesCame(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await facesCame(page)
})

test('signed in: the scanner’s worker and wasm, a receipt’s photo and a picture to the developer', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit keeps no Secure cookie on http://127.0.0.1, so a session never comes back after a load',
  )
  // Reading waits long: the first read compiles the 931 KB wasm (scanner.spec's READ).
  test.setTimeout(90_000)
  await context.grantPermissions(['camera'])

  // The seam asked by the page itself, as the development build's button asks it: the API of the run
  // carries it, and the cookie is set by the browser on this origin.
  await page.goto('/')
  const status = await page.evaluate(
    async () => (await fetch('/api/dev/login', { method: 'POST' })).status,
  )
  expect(status).toBe(201)
  await page.goto('/purchases')
  // A session found on a device that never claimed it is asked about first (MOL-56), then the terms.
  await page.getByRole('button', { name: 'Yes, that is me' }).click()
  await page.getByRole('checkbox', { name: AGE }).check()
  await page.getByRole('button', { name: ACCEPT }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Purchases' })).toBeVisible()
  await facesCame(page)

  // A receipt's photo: a `blob:` in the sheet, cut out at «Receipt edges» by the warp's worker.
  await page.getByRole('button', { name: 'Photograph a receipt' }).click()
  await risen(page)
  await page
    .locator('dialog[open] input[type="file"]:not([capture])')
    .first()
    .setInputFiles({ name: 'part-1.jpg', mimeType: 'image/jpeg', buffer: await aPhoto(page) })
  const edges = page.locator('dialog[open]').filter({ hasText: 'Receipt edges' })
  await expect(edges).toBeVisible()
  await risen(page)
  await edges.getByRole('button', { name: 'Done' }).click()
  await expect(edges).toHaveCount(0)
  await drawn(page.locator('dialog[open] img.photo').first())

  // The scanner: its worker from the app's origin compiles the wasm and reads the code filmed.
  await page.goto('/purchases/manual/add')
  await page.getByRole('button', { name: 'Scan a barcode' }).click()
  await expect(
    page.locator('.code-card').getByText(`The catalogue does not know the code ${BARCODE}`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: 45_000 })

  // A picture from the gallery, drawn anew by the phone and shown before sending, as `blob:`.
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Write to the developer' }).click()
  await risen(page)
  const sheet = page.getByRole('dialog')
  await sheet.getByText('Broken', { exact: true }).click()
  await sheet
    .locator('input[type="file"]')
    .setInputFiles({ name: 'screen.jpg', mimeType: 'image/jpeg', buffer: await aPhoto(page) })
  await drawn(sheet.getByRole('img', { name: 'Picture 1' }))
})

/** A photo the browser itself draws and encodes: a sheet of paper with rows on it. */
async function aPhoto(page: Page): Promise<Buffer> {
  const url = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 900
    canvas.height = 1600
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#f7f3ea'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#222'
    for (let y = 80; y < canvas.height - 80; y += 60) context.fillRect(60, y, 600, 18)
    return canvas.toDataURL('image/jpeg', 0.9)
  })
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}
