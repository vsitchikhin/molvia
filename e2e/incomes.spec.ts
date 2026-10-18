import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { actorCodec, settingsOf } from '@molvia/model'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

// The English words are the dictionary's, never a copy in the spec: a longer hint there must fail here
// (adversarial А3).
const en = JSON.parse(
  readFileSync(new URL('../frontend/src/i18n/en.json', import.meta.url), 'utf8'),
) as { income: { sheet: { note_placeholder: string } } }

/**
 * «Доходы» end to end (MOL-66): an income written on the screen lands in its month with the sum
 * the server worked out, an amendment keeps the version before it, and a removal can be taken
 * back — what no component test shows is that the screen and the server agree on all three.
 */
test('an income lands in its month, is amended with a trace, and comes back after removal', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Доходы' }).click()

  await expect(page.getByRole('heading', { name: 'Доходов пока нет' })).toBeVisible()
  await page.getByRole('button', { name: 'Записать доход' }).click()

  const sheet = page.locator('dialog[open]')
  await expect(sheet).toContainText('Сколько и когда пришло')
  // The sheet takes no tap while it rises.
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('99615')
  // Without a source nothing is sent (В-3).
  await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
  await expect(sheet).toContainText('Выберите, откуда пришли деньги')
  await sheet.getByLabel('Откуда').selectOption('salary')
  await sheet.getByLabel('Заметка').fill('Викаса')
  await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
  await expect(sheet).toBeHidden()

  // The month and its sum, by the heading — the server's figure, not the phone's; this year's month
  // is named without its year (MOL-188, В-2 «а»).
  await expect(page.getByRole('heading', { name: /^[а-яё]+ 99 615 ₽$/ })).toBeVisible()
  const row = page.locator('button.body')
  await expect(row).toContainText('Зарплата')
  await expect(row).toContainText('Викаса')

  // An amendment: the row opens it, the sum moves, the row says so, the old version stays.
  await row.click()
  await expect(sheet).toContainText('Правка дохода')
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('102345')
  await sheet.getByRole('button', { name: 'Сохранить правку' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('heading', { name: /^[а-яё]+ 102 345 ₽$/ })).toBeVisible()
  // «исправлен» stands in the card's head, beside the day, outside the button (MOL-81).
  await expect(page.locator('article .amended')).toContainText('исправлен')
  await row.click()
  await expect(sheet.locator('.versions')).toContainText('99 615,00 ₽')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  // Removal asks first, and «Вернуть» brings the same income back.
  await page.getByRole('button', { name: /Удалить доход/ }).click()
  await expect(sheet).toContainText('Удалить доход?')
  await page.waitForTimeout(400)
  await sheet.getByRole('button', { name: 'Удалить доход' }).click()
  await expect(page.getByRole('heading', { name: 'Доходов пока нет' })).toBeVisible()
  await page.getByRole('button', { name: 'Вернуть' }).click()
  await expect(page.getByRole('heading', { name: /^[а-яё]+ 102 345 ₽$/ })).toBeVisible()
  await expect(page.locator('article .amended')).toContainText('исправлен')
})

/**
 * An income moves the wallet (MOL-66, В-1): drams that came in are valued at the central bank of
 * their day, and a run has no cached rates — so the cost of the drams becomes unknown, «Обмен
 * денег» names the income it was lost on, and the next trip takes no rate of the person's own.
 * The number the bank gives is pinned by the integration tests, where the cache can be filled.
 */
test('drams that came in with no rate of their day make the wallet unknown, and say so', async ({
  page,
}) => {
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Обмен денег' }).click()

  const sheet = page.locator('dialog[open]')
  await page.getByRole('button', { name: 'Записать обмен' }).click()
  await page.waitForTimeout(400)
  await sheet.getByLabel('Отдал').fill('20000')
  await sheet.getByLabel('Получил').fill('95000')
  await sheet.getByRole('button', { name: 'Сохранить обмен' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('.figure')).toHaveText('4,75 ֏/₽')

  await page.goBack()
  await page.getByRole('link', { name: 'Доходы' }).click()
  await page.getByRole('button', { name: 'Записать доход' }).click()
  await page.waitForTimeout(400)
  await sheet.getByLabel('Сумма').fill('200000')
  await sheet.getByLabel('Валюта').selectOption('AMD')
  await expect(sheet).toContainText('Купили эти деньги за ₽?')
  await sheet.getByLabel('Откуда').selectOption('freelance')
  await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
  await expect(sheet).toBeHidden()

  await page.goBack()
  await page.getByRole('link', { name: 'Обмен денег' }).click()
  await expect(page.getByText(/Курс неизвестен: поступление ֏ от/)).toBeVisible()

  const headers = await asBrowser(page)
  const me = actorCodec.parse(await (await page.request.get('/api/actors/me', { headers })).json())
  const started = await page.request.post('/api/trips', {
    headers,
    data: {
      id: randomUUID(),
      context: settingsOf(me),
      place: { kind: 'store', name: 'Ереван Сити' },
    },
  })
  expect(started.status()).toBe(201)
  // No rate of the person's own, and no cached official rate either.
  expect(await started.json()).toMatchObject({ rate: null })
})

/**
 * «Записать доход» is the strip's over the tab bar, not a button floating over the list (MOL-188,
 * Ф-28): at the end of the scroll the last card ends above the strip, and without a connection the
 * button stays, not now, saying why on itself, under one line of the connection (Ф-6, Ф-14, Р-1).
 */
test('«Записать доход» stands in the strip: the last card ends above it, offline it says why', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 640 })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Доходы' }).click()
  await expect(page.getByRole('heading', { name: 'Доходов пока нет' })).toBeVisible()
  // The empty screen offers it in the strip too, and nowhere else (Ф-16).
  const record = page.locator('.dock').getByRole('button', { name: 'Записать доход', exact: true })
  await expect(record).toBeVisible()
  await expect(page.getByRole('button', { name: /Записать доход/ })).toHaveCount(1)

  const sheet = page.locator('dialog[open]')
  for (const [amount, note] of [
    ['99615', 'за сентябрь'],
    ['20385', ''],
    ['150000', 'аванс'],
  ] as const) {
    await record.click()
    await expect(sheet).toContainText('Сколько и когда пришло')
    await page.waitForTimeout(400)
    await sheet.getByLabel('Сумма').fill(amount)
    await sheet.getByLabel('Откуда').selectOption('salary')
    if (note) await sheet.getByLabel('Заметка').fill(note)
    await sheet.getByRole('button', { name: 'Сохранить доход' }).click()
    await expect(sheet).toBeHidden()
  }
  await expect(page.locator('article')).toHaveCount(3)

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  await page.waitForTimeout(300)
  const [last, dock] = await Promise.all([
    page.locator('article').last().boundingBox(),
    page.locator('.dock').boundingBox(),
  ])
  expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(dock?.y ?? 0)

  await context.setOffline(true)
  // The strip's own node: its words are said in the live region too (MOL-181, В1 of MOL-187).
  const strip = page.locator('.strip', { hasText: /Без связи · доходы на/ })
  await expect(strip).toHaveText(/^Без связи · доходы на .+\d:\d\d$/)
  const offline = page
    .locator('.dock')
    .getByRole('button', { name: 'Записать доход можно со связью' })
  await expect(offline).toHaveAttribute('aria-disabled', 'true')
  // Playwright itself counts an `aria-disabled` button as disabled: the tap is forced, as a finger's.
  await offline.click({ force: true })
  await page.waitForTimeout(400)
  await expect(sheet).toHaveCount(0)

  await context.setOffline(false)
  await expect(record).toBeVisible()
  await expect(record).not.toHaveAttribute('aria-disabled', 'true')
  await expect(strip).toBeHidden()
})

/**
 * The hint of «Заметка» is whole in its field (MOL-188, Е-11): a placeholder is one line and never
 * wraps, so the words must fit the field of a 360 px phone — in either language, set in the field's
 * own face, size and spacing.
 */
test('the hint of the income’s note fits its field on a 360 px phone, in both languages', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await signedIn(page)
  await page.getByRole('link', { name: 'Деньги', exact: true }).click()
  await page.getByRole('link', { name: 'Доходы' }).click()
  await page.locator('.dock').getByRole('button', { name: 'Записать доход', exact: true }).click()
  const note = page.locator('dialog[open]').getByLabel('Заметка')
  await expect(note).toHaveAttribute('placeholder', 'Например, «за сентябрь»')
  // The English words of `income.sheet.note_placeholder`, drawn beside the Russian ones.
  const texts = [(await note.getAttribute('placeholder')) ?? '', en.income.sheet.note_placeholder]
  const room = await note.evaluate(async (field: HTMLInputElement, words: string[]) => {
    await document.fonts.ready
    const style = getComputedStyle(field)
    const inner = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    return words.map((text) => {
      const probe = document.createElement('span')
      for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing'] as const) {
        probe.style[key] = style[key]
      }
      probe.style.whiteSpace = 'pre'
      probe.style.position = 'absolute'
      probe.textContent = text
      document.body.append(probe)
      const width = probe.getBoundingClientRect().width
      probe.remove()
      return inner - width
    })
  }, texts)
  for (const left of room) expect(left).toBeGreaterThan(0)
})

/** A day of the month `back` months before this one, as `YYYY-MM-DD`: the 10th to the 20th, any zone. */
function monthsBack(back: number, day: number): string {
  const now = new Date()
  const at = new Date(now.getFullYear(), now.getMonth() - back, day)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * The skeleton of «Доходы» is the answer's shape in height too (MOL-188, adversarial А2, Б2; MOL-178):
 * its cards are an income's — the head of the bin, the line of the figure, a plate of the account and the
 * note — in two months, so neither a card nor the second month comes down by what the bars lacked. A
 * person with an account has a plate on every card, since a new income lands on it untouched.
 */
for (const withAccount of [false, true]) {
  test(`the skeleton stands where the incomes come, two months, ${withAccount ? 'with an account' : 'with none'}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signedIn(page)
    const headers = await asBrowser(page)
    const account = withAccount ? randomUUID() : null
    if (account) {
      const made = await page.request.post('/api/money/accounts', {
        headers,
        data: {
          id: account,
          name: 'Карта ₽',
          currency: 'RUB',
          savings: false,
          start: { amount: '1000', currency: 'RUB' },
          startOn: monthsBack(4, 1),
        },
      })
      expect(made.status(), await made.text()).toBe(201)
    }
    // The skeleton's own shape, month by month: with an account — the account and a note, the account;
    // the account. With none — a note, nothing; a note.
    for (const [receivedOn, note] of [
      [monthsBack(1, 20), 'за сентябрь'],
      [monthsBack(1, 10), null],
      [monthsBack(2, 15), withAccount ? null : 'аванс'],
    ] as const) {
      const written = await page.request.post('/api/incomes', {
        headers,
        data: {
          id: randomUUID(),
          amount: { amount: '20385', currency: 'RUB' },
          receivedOn,
          source: 'salary',
          ...(note ? { note } : {}),
          ...(account ? { accountId: account } : {}),
        },
      })
      expect(written.status(), await written.text()).toBe(201)
    }
    await page.getByRole('link', { name: 'Деньги', exact: true }).click()
    await page.getByRole('link', { name: 'Доходы' }).click()
    await expect(page.locator('article')).toHaveCount(3)
    const measure = (cards: Element[]) =>
      cards.map((card) => ({
        top: card.getBoundingClientRect().top,
        height: card.getBoundingClientRect().height,
      }))
    const answer = await page.locator('article').evaluateAll(measure)

    // The same screen again, its read held: the skeleton stands until it is let go.
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(/\/api\/incomes(\?|$)/, async (route) => {
      await held
      await route.continue()
    })
    await page.goBack()
    await page.getByRole('link', { name: 'Доходы' }).click()
    const entries = page.locator('.skeleton .entry')
    await expect(entries).toHaveCount(3)
    const skeleton = await entries.evaluateAll(measure)
    release()
    await expect(page.locator('article')).toHaveCount(3)
    test
      .info()
      .annotations.push({ type: 'boxes', description: JSON.stringify({ skeleton, answer }) })

    // Each card is as tall as its bars, within the card's hairline edge the bars do not draw; each
    // starts where its bars did, within the prices named above it — 3 px a caption holding its sum of
    // 13 beside words of 11, which the kit's caption bar does not, and 2 px an edge.
    const captionsAbove = [1, 1, 2]
    answer.forEach((card, index) => {
      const bars = skeleton[index]
      expect(Math.abs(card.height - (bars?.height ?? 0))).toBeLessThanOrEqual(3)
      const room = 3 * (captionsAbove[index] ?? 0) + 2 * index + 1
      expect(Math.abs(card.top - (bars?.top ?? 0))).toBeLessThanOrEqual(room)
    })
  })
}
