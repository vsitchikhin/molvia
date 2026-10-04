import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { open, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

// `--sunken` of each scheme, the ground `body` is painted with (`_tokens.scss`).
const GROUND = { light: 'rgb(243, 232, 214)', dark: 'rgb(20, 17, 15)' }

function scheme(page: Page) {
  return page.getByRole('group', { name: 'Тема', exact: true })
}

async function choose(page: Page, word: 'Системная' | 'Светлая' | 'Тёмная'): Promise<void> {
  const radio = scheme(page).getByRole('radio', { name: word, exact: true })
  // Into the middle: at the edge of the window the group lies under the dock and the tab bar.
  await scheme(page).evaluate((group) => {
    group.scrollIntoView({ block: 'center' })
  })
  // The segment is tapped, as a finger does: its radio is hidden under it.
  await scheme(page).locator('label.segment', { hasText: word }).click()
  await expect(radio).toBeChecked()
}

async function drawn(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const media = (of: string) =>
      document
        .querySelector(`meta[name="theme-color"][data-scheme-of="${of}"]`)
        ?.getAttribute('media') ?? null
    return {
      mark: root.dataset.scheme ?? null,
      colorScheme: getComputedStyle(root).colorScheme,
      ground: getComputedStyle(document.body).backgroundColor,
      bar: { light: media('light'), dark: media('dark') },
      kept: localStorage.getItem('molvia.scheme'),
    }
  })
}

test('the scheme chosen on this phone wins over the system both ways, and is there before the app', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await signedIn(page, '/settings')
  await expect(scheme(page).getByRole('radio', { name: 'Системная', exact: true })).toBeChecked()

  await choose(page, 'Тёмная')
  expect(await drawn(page)).toEqual({
    mark: 'dark',
    // Without it a native `<select>` or date of the screen would stay light (MOL-111, Р-1).
    colorScheme: 'dark',
    ground: GROUND.dark,
    bar: { light: 'not all', dark: 'all' },
    kept: 'dark',
  })

  // The app itself kept away: what is drawn now is the script in the head, alone.
  await page.route('**/src/main.ts*', (route) => route.abort())
  await page.reload()
  // Review С-2: proven kept away, or `installColorScheme` would pass for the script.
  await expect(page.locator('#app')).toBeEmpty()
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'dark')
  await expect(page.locator('meta[data-scheme-of="dark"]')).toHaveAttribute('media', 'all')
  await page.unroute('**/src/main.ts*')
  await page.reload()

  // The other way: «Светлая» on a dark system was dark until MOL-111 — no light values under the mark.
  await page.emulateMedia({ colorScheme: 'dark' })
  await choose(page, 'Светлая')
  expect(await drawn(page)).toEqual({
    mark: 'light',
    colorScheme: 'light',
    ground: GROUND.light,
    bar: { light: 'all', dark: 'not all' },
    kept: 'light',
  })

  await choose(page, 'Системная')
  expect(await drawn(page)).toEqual({
    mark: null,
    colorScheme: 'light dark',
    ground: GROUND.dark,
    bar: { light: '(prefers-color-scheme: light)', dark: '(prefers-color-scheme: dark)' },
    kept: 'system',
  })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect.poll(async () => (await drawn(page)).ground).toBe(GROUND.light)
})

test('«Системная» is one line in its segment on a 320 px phone, and nothing scrolls sideways', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await signedIn(page, '/settings')
  for (const chosen of ['Системная', 'Тёмная'] as const) {
    await choose(page, chosen)
    const words = await scheme(page)
      .locator('.word')
      .evaluateAll((all) =>
        all.map((word) => {
          const segment = word.parentElement
          const line = parseFloat(getComputedStyle(word).lineHeight)
          return {
            word: word.textContent,
            oneLine: word.getBoundingClientRect().height < line * 1.5,
            inside: segment ? segment.scrollWidth <= segment.clientWidth : false,
          }
        }),
      )
    expect(words).toEqual(
      ['Системная', 'Светлая', 'Тёмная'].map((word) => ({ word, oneLine: true, inside: true })),
    )
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await testInfo.attach('scheme-320-dark', {
    body: await scheme(page).screenshot(),
    contentType: 'image/png',
  })
})

test('another window of the app follows the choice, and one that missed it comes back to it', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await signedIn(page, '/settings')
  const other = await context.newPage()
  await other.emulateMedia({ colorScheme: 'light' })
  await open(other)
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible()
  await choose(page, 'Тёмная')
  await expect(other.locator('html')).toHaveAttribute('data-scheme', 'dark')
  await choose(page, 'Светлая')
  await expect(other.locator('html')).toHaveAttribute('data-scheme', 'light')
  // Its own shelf followed too: a reload of it does not bring the old choice back.
  await other.reload()
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(other.locator('html')).toHaveAttribute('data-scheme', 'light')
  // Adversarial В: away while «Системная» was chosen — unloaded, as a browser does to a tab behind —
  // it heard nothing, and its own shelf still says «Светлая».
  await other.goto('about:blank')
  await choose(page, 'Системная')
  await open(other)
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(other.locator('html')).not.toHaveAttribute('data-scheme')
})

/** Scrolls the page until the middle of `target` stands `y` from the top of the window. */
async function bringTo(page: Page, target: Locator, y: number): Promise<void> {
  const box = await target.boundingBox()
  if (!box) throw new Error('no box')
  await page.evaluate(
    (by) => {
      window.scrollBy(0, by)
    },
    box.y + box.height / 2 - y,
  )
  await expect
    .poll(async () => {
      const now = await target.boundingBox()
      return now ? Math.abs(now.y + now.height / 2 - y) <= 1 : false
    })
    .toBe(true)
}

// Adversarial Д: the word, lifted over its segment's hit area, rose over the pinned header as well —
// drawn through it, and a tap on the header chose a scheme («‹ Деньги» on «Графики» went nowhere).
test('a segment scrolled under the pinned header stays under it, and the header keeps its taps', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.emulateMedia({ colorScheme: 'light' })
  await signedIn(page, '/settings')
  // The group over «Тема» loads by a request of its own, and its answer redraws it (the switch comes
  // enabled, its description changes). Measured before that, the point once missed the header on CI
  // (MOL-171) — the exact move was not caught; measured after, nothing over the word is pending. The
  // bot's row (MOL-129) is a link that loads nothing.
  await expect(page.getByRole('switch', { name: 'Зарплата — в следующий месяц' })).toBeEnabled()
  const bar = await page.locator('header.bar').boundingBox()
  if (!bar) throw new Error('no header')
  const word = scheme(page).locator('.word', { hasText: 'Тёмная' })
  await bringTo(page, word, bar.y + bar.height / 2)
  const box = await word.boundingBox()
  if (!box) throw new Error('no word')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  expect(y).toBeLessThan(bar.y + bar.height)
  expect(
    await page.evaluate(
      (at) => document.elementFromPoint(at.x, at.y)?.closest('header.bar') !== null,
      { x, y },
    ),
  ).toBe(true)
  await page.mouse.click(x, y)
  await expect(scheme(page).getByRole('radio', { name: 'Системная', exact: true })).toBeChecked()
  await expect(page.locator('html')).not.toHaveAttribute('data-scheme')
})
