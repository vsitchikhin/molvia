// MOL-269, adversarial round 5 — end-to-end. A green test means the defect is alive. Put in e2e/ of the
// branch MOL-269-mutations over the PR's head, run by CI on a draft PR; never merged.
import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'no-preference' })

// Д1e. The rule now reads (money-spendings.md, ed2f91a2): «what holds is the tap, not the sight … an
// answer faster than the fade … moves them faded only part-way, not unseen, and nothing aimed at them
// lands there». Round 4 showed it for a newcomer only, whose rows go up and leave nothing under the old
// place. A person with a spending: the month's card and «Куда ушли» stand where the small error card was,
// the rows go down, and under the place «Обмен денег» was seen at — part-faded, still there — comes
// whatever the answer put there. The finger aimed at «Обмен денег» lands on it.
test('Д1e: a month with a spending, «Повторить» answered fast — a tap aimed at «Обмен денег» lands on what the answer put there', async ({
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

  const answered = page.waitForResponse('**/api/money/months/**')
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
  console.log('Д1e', JSON.stringify({ from: box.y, to: moved?.y ?? null, under, url: page.url() }))

  expect(moved?.y).not.toBe(box.y)
  expect(new URL(page.url()).pathname).not.toBe('/money')
  expect(new URL(page.url()).pathname).not.toBe('/money/exchange')
})
