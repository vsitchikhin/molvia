// MOL-269, adversarial round 3 — end-to-end. A green test means the defect is alive. Put in e2e/ of the
// branch MOL-269-mutations over the PR's head, run by CI on a draft PR; never merged.
import { expect, test } from '@playwright/test'
import { signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'no-preference' })

// В1e. MOL-151: «Nothing comes or goes in one frame» — `appear` for what is put in, `AppReveal` for what
// pushes its neighbours, «never for an answer read (more than three rows at once)». `ways-held` is
// `visibility: hidden`: on «Повторить» the six rows go in one frame, and on a refusal — no answer read,
// the same card over them — they come back in one frame, with nothing played on them either way. The
// same rows, put in the page, come in by `appear(0)` (money-spendings.md).
test('В1e: «Повторить» refused — the six ways out go and come back in one frame, nothing played', async ({
  page,
}) => {
  let reads = 0
  let release: () => void = () => undefined
  const released = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/api/money/months/**', async (route) => {
    reads += 1
    if (reads > 1) await released
    await route.fulfill({ status: 500, body: '{}' })
  })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить траты' })).toBeVisible()
  const nav = page.locator('nav').filter({ has: page.getByRole('link', { name: /^Обмен денег/ }) })
  await expect(nav).toBeVisible()
  // Every animation still running in the page played out: the rows' own `appear` included.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.playState === 'running')
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  )

  // Each frame: is the row seen, how opaque, and is anything playing on the rows.
  await page.evaluate(() => {
    const frames: { seen: boolean; opacity: number; playing: number }[] = []
    const link = [...document.querySelectorAll('a')].find((one) =>
      one.textContent.trim().startsWith('Обмен денег'),
    )
    const rows = link?.closest('nav')
    const frame = () => {
      if (rows && link) {
        const style = getComputedStyle(link)
        frames.push({
          seen: style.visibility === 'visible',
          opacity: Number(getComputedStyle(rows).opacity),
          playing: document.getAnimations().filter((animation) => {
            const target = (animation.effect as KeyframeEffect | null)?.target
            return !!target && (rows.contains(target) || target.contains(rows))
          }).length,
        })
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
    Object.assign(window, { frames })
  })

  await page.getByRole('button', { name: 'Повторить' }).click()
  await expect(nav).toBeHidden()
  const refused = page.waitForResponse('**/api/money/months/**')
  release()
  await refused
  await expect(nav).toBeVisible()
  await page.waitForTimeout(500)

  const frames = await page.evaluate(
    () =>
      (window as unknown as { frames: { seen: boolean; opacity: number; playing: number }[] })
        .frames,
  )
  const gone = frames.findIndex((frame, at) => at > 0 && frames[at - 1]?.seen && !frame.seen)
  const back = frames.findIndex((frame, at) => at > gone && !frames[at - 1]?.seen && frame.seen)
  console.log(
    'В1e',
    JSON.stringify({
      frames: frames.length,
      gone,
      back,
      around: frames
        .slice(Math.max(0, gone - 1), gone + 1)
        .concat(frames.slice(back - 1, back + 2)),
      played: frames.reduce((most, frame) => Math.max(most, frame.playing), 0),
    }),
  )
  expect(gone).toBeGreaterThan(0)
  expect(back).toBeGreaterThan(gone)
  // Whole in the frame before, gone in the next; gone, then whole — and nothing played on them.
  expect(frames[gone - 1]?.opacity).toBe(1)
  expect(frames[back]?.opacity).toBe(1)
  expect(frames.reduce((most, frame) => Math.max(most, frame.playing), 0)).toBe(0)
})
