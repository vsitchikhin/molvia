// MOL-269, adversarial round 6 — end-to-end. A green test means the defect is alive. Put in e2e/ of the
// branch MOL-269-mutations over the PR's head, run by CI on a draft PR; never merged.
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'no-preference' })

// Е1e. The price (money-spendings.md, 86e37171): «The window is the answer's own time, tens of milliseconds:
// less than a press on «Повторить» and a second on a row take, while an answer slower than the fade finds
// the rows gone». Tens of milliseconds is the runner's loopback. On a phone the answer's time is the
// network's: answered in 120 ms — well under the fade's 220 — the rows stand seen where they were for
// over 100 ms after the press, then the answer moves them, and the tap aimed at «Обмен денег» opens
// «Графики» all the same.
test('Е1e: a month with a spending, «Повторить» answered fast — a tap aimed at «Обмен денег» lands on what the answer put there', async ({
  page,
}) => {
  await signedIn(page)
  const headers = await asBrowser(page)
  const { categories } = (await (
    await page.request.get('/api/spending-categories', { headers })
  ).json()) as { categories: { id: string }[] }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Yerevan' }).format(new Date())
  const spent = await page.request.post('/api/spendings', {
    headers,
    data: {
      id: randomUUID(),
      spentOn: today,
      amount: { amount: '5000', currency: 'AMD' },
      categoryId: categories[0]?.id,
      note: 'Барбер',
    },
  })
  expect(spent.status(), await spent.text()).toBe(201)

  let failed = false
  await page.route('**/api/money/months/**', async (route) => {
    if (!failed) {
      failed = true
      await route.fulfill({ status: 500, body: '{}' })
      return
    }
    // An answer as a phone's network gives it, not the tens of milliseconds of a runner's loopback.
    await new Promise((resolve) => setTimeout(resolve, 120))
    await route.continue()
  })
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

  // Each frame until the answer is on screen: when, how opaque, and is «Обмен денег» where it was.
  await page.evaluate((top) => {
    const frames: { at: number; seen: boolean; opacity: number; still: boolean }[] = []
    const frame = (at: number) => {
      const rows = [...document.querySelectorAll('nav')].find((nav) =>
        nav.textContent.includes('Обмен денег'),
      )
      const link = [...(rows?.querySelectorAll('a') ?? [])].find((one) =>
        one.textContent.includes('Обмен денег'),
      )
      if (rows && link) {
        const style = getComputedStyle(rows)
        frames.push({
          at,
          seen: style.visibility === 'visible',
          opacity: Number(style.opacity),
          still: Math.abs(link.getBoundingClientRect().top - top) < 1,
        })
      }
      if (document.body.textContent.includes('Не удалось загрузить траты'))
        requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    Object.assign(window, { frames })
  }, box.y)

  const answered = page.waitForResponse('**/api/money/months/**')
  const pressed = await page.evaluate(() => performance.now())
  await page.getByRole('button', { name: 'Повторить' }).click()
  await answered
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить траты' })).toHaveCount(0)
  const moved = await exchange.boundingBox()
  const under = await page.evaluate(
    ([px, py]) => {
      const node = document.elementFromPoint(px ?? 0, py ?? 0)
      const link = node?.closest('a, button')
      return {
        text: node?.textContent.trim().slice(0, 60) ?? null,
        link: link?.getAttribute('href') ?? link?.textContent.trim().slice(0, 40) ?? null,
        opacity: [...document.querySelectorAll('nav')]
          .filter((nav) => nav.textContent.includes('Обмен денег'))
          .map((nav) => getComputedStyle(nav).opacity),
      }
    },
    [x, y],
  )
  // The finger arrives where «Обмен денег» was seen.
  await page.mouse.click(x, y)
  await page.waitForTimeout(1_000)
  const frames = await page.evaluate(
    () =>
      (
        window as unknown as {
          frames: { at: number; seen: boolean; opacity: number; still: boolean }[]
        }
      ).frames,
  )
  const seenWhere = frames.filter(
    (frame) => frame.at > pressed && frame.still && frame.seen && frame.opacity >= 0.1,
  )
  const seenFor = seenWhere.length ? Math.max(...seenWhere.map((frame) => frame.at)) - pressed : 0
  console.log(
    'Е1e',
    JSON.stringify({
      from: box.y,
      to: moved?.y ?? null,
      seenFor,
      frames: frames.length,
      under,
      url: page.url(),
    }),
  )
  // Seen where it was for longer than tens of milliseconds, and the tap went to «Графики».
  expect(seenFor).toBeGreaterThanOrEqual(100)

  expect(moved?.y).not.toBe(box.y)
  expect(new URL(page.url()).pathname).not.toBe('/money')
  expect(new URL(page.url()).pathname).not.toBe('/money/exchange')
})
