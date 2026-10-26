// MOL-269, adversarial round 1 — end-to-end. A green test means the defect is alive. Put in e2e/ of the
// branch MOL-269-mutations over the PR's head, run by CI on a draft PR; never merged.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'no-preference' })

/** As `motion.spec`: the move over and every finite animation played out. */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.nav ?? null))
    .toBeNull()
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number(animation.effect?.getComputedTiming().endTime) !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )
}

// А1e. The price says «Повторить» after a month that failed brings the skeleton back and takes the ways
// out with it. It does not (`retry` is `load`, the phase stays `error`): the rows stand while the retry
// is on its way, the answer moves them, and a press on «Обмен денег» released after the answer is a
// click on nothing — the tap of MOL-269, one press after «Повторить».
test('А1e: «Повторить», a press on «Обмен денег», the answer, the release — «Деньги» stay', async ({
  page,
}) => {
  let failed = false
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => (release = resolve))
  // Laid before the page opens (MOL-249): the first read fails, the retry is held.
  await page.route('**/api/money/months/**', async (route) => {
    if (!failed) {
      failed = true
      await route.fulfill({ status: 500, body: '' })
      return
    }
    await released
    await route.continue()
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
  await expect(page.getByText('Не удалось загрузить траты')).toBeVisible()
  const exchange = page.getByRole('link', { name: /^Обмен денег/ })
  await expect(exchange).toBeVisible()

  await page.getByRole('button', { name: 'Повторить' }).click()
  // The retry is out: no skeleton came, the rows are there to be pressed.
  await expect(page.locator('.skeleton')).toHaveCount(0)
  await expect(exchange).toBeVisible()
  await exchange.scrollIntoViewIfNeeded()
  const before = await exchange.boundingBox()
  if (!before) throw new Error('no «Обмен денег»')
  const x = before.x + before.width / 2
  const y = before.y + before.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()

  const answered = page.waitForResponse('**/api/money/months/**')
  release()
  await answered
  await expect(page.getByRole('heading', { name: 'Добавьте первую трату' })).toBeVisible()
  const after = await exchange.boundingBox()
  const under = await page.evaluate(
    ([px, py]) =>
      document
        .elementFromPoint(px ?? 0, py ?? 0)
        ?.textContent?.trim()
        .slice(0, 60) ?? null,
    [x, y],
  )
  await page.mouse.up()
  test.info().annotations.push({
    type: 'А1e',
    description: `«Обмен денег» y ${before.y} → ${after?.y}; under the finger at the release: ${under}`,
  })

  expect(after?.y).not.toBe(before.y)
  // The press went nowhere: no screen of the exchange, after a wait for a move that would have begun.
  await page.waitForTimeout(1_000)
  await expect(page).toHaveURL(/\/money$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Деньги')
})

// А5e. The groups of «Настройки» are slotted children of `AppScreen`, which gives each `appear`; `v-show`
// turning `display` back on starts it anew. The salary's day is read afresh on every mount, so every
// opening — a step back by the browser too — plays the six groups in after the move: by `motion.spec`
// А5's own measure, read the moment they are shown, the very `Received: 6` of CI run 40378218693.
test('А5e: a step back by the browser to «Настройки» — six groups fade in after the move', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', { get: () => true })
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
  await page.getByRole('link', { name: 'Устройства', exact: true }).click()
  await expect(page.locator('section.list')).toBeVisible()
  await settled(page)

  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/actors/me/salary-shift', async (route) => {
    await released
    await route.continue()
  })

  // The mark of the browser's move, and А5's count taken the moment the groups are shown.
  await page.evaluate(() => {
    const move: { marked: boolean; over: number | null; atShown: number | null; groups: number } = {
      marked: false,
      over: null,
      atShown: null,
      groups: 0,
    }
    new MutationObserver(() => {
      if (document.documentElement.dataset.nav === 'browser') move.marked = true
      else if (move.marked && move.over === null) move.over = Number(document.timeline.currentTime)
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] })
    new MutationObserver(() => {
      const leave = [...document.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === 'Выйти',
      )
      if (move.atShown !== null || move.over === null || !leave?.checkVisibility()) return
      const appear = document
        .getAnimations()
        .filter(
          (animation): animation is CSSAnimation =>
            animation instanceof CSSAnimation &&
            animation.animationName === 'appear' &&
            animation.playState === 'running' &&
            Number(animation.effect?.getComputedTiming().duration) > 0,
        )
      // The filter of motion.spec А5, word for word.
      move.atShown = appear.filter(
        (animation) => Number(animation.startTime) < (move.over ?? 0) - 1,
      ).length
      move.groups = appear.filter(
        (animation) =>
          (animation.effect as KeyframeEffect | null)?.target?.matches('.group') === true,
      ).length
    }).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true })
    Object.assign(window, { move })
  })

  await page.goBack()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Настройки')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.nav ?? null))
    .toBeNull()
  // After the move: the form is there, the groups are not.
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeHidden()

  const answered = page.waitForResponse('**/api/actors/me/salary-shift')
  release()
  await answered
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible()
  const move = await page.evaluate(
    () =>
      (window as unknown as { move: { marked: boolean; atShown: number | null; groups: number } })
        .move,
  )
  test.info().annotations.push({ type: 'А5e', description: JSON.stringify(move) })
  expect(move.marked).toBe(true)
  expect(move.groups).toBe(6)
  expect(move.atShown).toBe(6)
})
