/// <reference lib="dom" />
// DOM for the evaluated functions, which run in the browser.
import { createHash } from 'node:crypto'
import type { Page } from '@playwright/test'
import { SESSION_COOKIE } from '@molvia/model'
import { BARCODE } from './barcode-video'
import { expect, test } from './csp'
import { AGE, ACCEPT } from './session'

// MOL-363, the built app (`pwa-camera` and `pwa-iphone`): the policy is a meta only the build puts in,
// so this is the one place the app runs under it. Every step goes where a directive decides — the
// scripts of `index.html` by their hashes, the bundle and the faces, a worker and its wasm, a photo
// as `blob:` — and `csp.ts` fails it on any violation. It comes in by `page.goto`, not through
// `open()`: the development seam's button is not in a build (pwa-update.spec's reason).

// The first read compiles the 931 KB wasm: scanner.spec gives it 30 s, measured under load; here a login
// comes before it on the same page, so the read gets half as long again and the test twice the read.
const READ = 45_000

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
  // Parsed as the browser parses it, never by a pattern: a comment naming `<script>`, a script with
  // attributes or in capitals is what the browser hashes, or does not.
  const built = await page.evaluate((text) => {
    const document = new DOMParser().parseFromString(text, 'text/html')
    const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]')
    const scripts = [...document.querySelectorAll('script')]
    return {
      policy: meta?.getAttribute('content') ?? null,
      first: scripts.every(
        (script) =>
          meta !== null &&
          (meta.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      ),
      inline: scripts.filter((script) => !script.hasAttribute('src')).map((one) => one.text),
    }
  }, html)
  expect(built.policy, 'no policy in the built index.html').not.toBeNull()
  expect(built.first, 'a script stands before the policy').toBe(true)
  const hashes = (built.policy ?? '')
    .split('; ')
    .find((directive) => directive.startsWith('script-src '))
    ?.split(' ')
    .filter((source) => source.startsWith("'sha256-"))
  expect(built.inline.length).toBeGreaterThan(0)
  expect(hashes?.toSorted()).toEqual(built.inline.map(sha256).toSorted())
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

/**
 * Signed in by the development seam, which the build has no button for and the run's API carries. On
 * Chromium the page asks it itself and the browser keeps the cookie; WebKit keeps no `Secure` cookie on
 * the loopback, so there the test asks it and puts the session in the jar itself (adversarial А1 of
 * review 1) — the page untouched. A session the device never claimed is asked about first (MOL-56),
 * then the terms.
 */
async function signIn(page: Page, browserName: string): Promise<void> {
  if (browserName === 'webkit') {
    const answer = await page.request.post('/api/dev/login')
    expect(answer.status()).toBe(201)
    // The session's, by its name: the seam sets the account it remembers first (CI, run 42209616807).
    const value = answer
      .headersArray()
      .filter(({ name }) => name.toLowerCase() === 'set-cookie')
      .map(({ value: line }) => line.split(';')[0] ?? '')
      .find((pair) => pair.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1)
    expect(value, 'the seam set no session').toBeTruthy()
    // Laid in the jar by the address, so not `Secure` on the loopback's http, which WebKit then keeps
    // and sends; a header laid by `route.continue` WebKit never sends — its `Cookie` is its own.
    await page.context().clearCookies()
    await page
      .context()
      .addCookies([
        { name: SESSION_COOKIE, value: value ?? '', url: new URL('/', answer.url()).href },
      ])
  } else {
    await page.goto('/')
    const status = await page.evaluate(
      async () => (await fetch('/api/dev/login', { method: 'POST' })).status,
    )
    expect(status).toBe(201)
  }
  await page.goto('/purchases')
  await page.getByRole('button', { name: 'Yes, that is me' }).click()
  await page.getByRole('checkbox', { name: AGE }).check()
  await page.getByRole('button', { name: ACCEPT }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Purchases' })).toBeVisible()
}

/** The screens with a `<select>` — WebKit's own report of one is the one `csp.ts` lets go. */
const WITH_A_SELECT = [
  ['/money/spendings', 'Spendings'],
  ['/money/budget', 'Budget'],
  ['/money/exchange', 'Money exchange'],
  ['/money/incomes', 'Income'],
  ['/money/accounts', 'Accounts'],
  ['/settings', 'Settings'],
] as const

test('signed in: a receipt’s photo and its edges, a picture to the developer, the screens with a select', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000)
  await signIn(page, browserName)
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

  for (const [path, title] of WITH_A_SELECT) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.locator('select').first()).toBeAttached()
  }
})

test('signed in: the scanner’s worker from the app’s origin compiles the wasm and reads the code filmed', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit has no fake camera to film the code')
  test.setTimeout(READ * 2)
  await context.grantPermissions(['camera'])
  await signIn(page, browserName)
  await page.goto('/purchases/manual/add')
  await page.getByRole('button', { name: 'Scan a barcode' }).click()
  await expect(
    page.locator('.code-card').getByText(`The catalogue does not know the code ${BARCODE}`, {
      exact: true,
    }),
  ).toBeVisible({ timeout: READ })
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
