// MOL-269, adversarial round 4 — end-to-end. A green test means the defect is alive. Put in e2e/ of the
// branch MOL-269-mutations over the PR's head, run by CI on a draft PR; never merged.
import { expect, test } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'no-preference' })

// Г1e. The rule says the ways out are «unseen with their place kept» while «Повторить» reads a failed
// month again. Faded out over `--appear-duration` (220 ms), they are unseen only if the answer is slower
// than the fade. A server that came back answers in tens of milliseconds: the rows never go — they stand
// seen, a little paler, and jump with the answer to where the month put them, `pointer-events` back the
// same frame. The finger already on its way to «Обмен денег» lands where it was, on another row, and
// opens another screen: the misplaced tap MOL-269 is about, in the one path the fix was for.
test('Г1e: «Повторить» answered fast — the rows never go unseen, and a tap where «Обмен денег» stood opens another screen', async ({
  page,
}) => {
  let failed = false
  await page.route('**/api/money/months/**', async (route) => {
    if (!failed) {
      failed = true
      await route.fulfill({ status: 500, body: '{}' })
      return
    }
    await route.continue()
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить траты' })).toBeVisible()
  const exchange = page.getByRole('link', { name: /^Обмен денег/ })
  await expect(exchange).toBeVisible()
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.playState === 'running')
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
  const box = await exchange.boundingBox()
  if (!box) throw new Error('no «Обмен денег»')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // Each frame: the rows seen or not, how opaque, until the answer is on screen.
  await page.evaluate(() => {
    const frames: { seen: boolean; opacity: number }[] = []
    const frame = () => {
      const rows = [...document.querySelectorAll('nav')].find((nav) =>
        nav.textContent.includes('Обмен денег'),
      )
      if (rows) {
        const style = getComputedStyle(rows)
        frames.push({ seen: style.visibility === 'visible', opacity: Number(style.opacity) })
      }
      if (!document.body.textContent.includes('Добавьте первую трату')) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    Object.assign(window, { frames })
  })

  const answered = page.waitForResponse('**/api/money/months/**')
  await page.getByRole('button', { name: 'Повторить' }).click()
  await answered
  await expect(page.getByRole('heading', { name: 'Добавьте первую трату' })).toBeVisible()
  const moved = await exchange.boundingBox()
  // The finger arrives where «Обмен денег» stood.
  await page.mouse.click(x, y)
  await page.waitForTimeout(1_000)
  const frames = await page.evaluate(
    () => (window as unknown as { frames: { seen: boolean; opacity: number }[] }).frames,
  )
  const unseen = frames.filter((frame) => !frame.seen || frame.opacity < 0.05).length
  const palest = frames.reduce((least, frame) => Math.min(least, frame.opacity), 1)
  console.log(
    'Г1e',
    JSON.stringify({
      frames: frames.length,
      unseen,
      palest,
      from: box.y,
      to: moved?.y ?? null,
      url: page.url(),
    }),
  )

  expect(unseen).toBe(0)
  expect(new URL(page.url()).pathname).toMatch(/^\/money\/(?!exchange$)/)
})
