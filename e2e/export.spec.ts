import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { exportFileCodec } from '@molvia/model'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/** A proposed item and a verdict on it — two sections of the file that only this person wrote. */
async function somethingOfMine(page: Page): Promise<{ name: string; review: string }> {
  const headers = await asBrowser(page)
  const name = `Мацун ${randomUUID().slice(0, 8)}`
  const review = `Кислит ${randomUUID().slice(0, 8)}`
  const proposed = await page.request.post('/api/catalogue/items', {
    headers,
    data: { kind: 'product', name, defaultUnit: 'kg' },
  })
  expect(proposed.status()).toBe(201)
  const { id } = (await proposed.json()) as { id: string }
  const rated = await page.request.put(`/api/verdicts/${id}`, {
    headers,
    data: { score: 2, review },
  })
  expect(rated.status()).toBe(201)
  return { name, review }
}

/** Whether the browser can share a file is the browser's; each test says which one it is. */
async function sharing(page: Page, mode: 'none' | 'refused-once'): Promise<void> {
  await page.addInitScript((kind) => {
    const w = window as unknown as { __shared: string[] }
    w.__shared = []
    if (kind === 'none') {
      Reflect.deleteProperty(Navigator.prototype, 'canShare')
      Reflect.deleteProperty(Navigator.prototype, 'share')
      return
    }
    let refused = false
    Object.defineProperty(Navigator.prototype, 'canShare', { value: () => true })
    Object.defineProperty(Navigator.prototype, 'share', {
      value: (data: ShareData) => {
        if (!refused) {
          refused = true
          return Promise.reject(new DOMException('late', 'NotAllowedError'))
        }
        w.__shared.push(...(data.files ?? []).map((file) => file.name))
        return Promise.resolve()
      },
    })
  }, mode)
}

test('«Скачать мои данные» отдаёт файл со своим — формат, версия, своя позиция и оценка', async ({
  page,
}) => {
  await sharing(page, 'none')
  await signedIn(page)
  const mine = await somethingOfMine(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Скачать мои данные/ }).click(),
  ])

  expect(download.suggestedFilename()).toMatch(/^molvia-\d{4}-\d{2}-\d{2}\.json$/)
  const file = exportFileCodec.parse(JSON.parse(await readFile(await download.path(), 'utf8')))
  expect(file.version).toBe(1)
  expect(file.proposedItems.map((item) => item.name)).toEqual([mine.name])
  expect(file.verdicts.map((verdict) => verdict.review)).toEqual([mine.review])
})

test('телефон не открыл лист так поздно — файл ждёт второго тапа и уходит им', async ({ page }) => {
  await sharing(page, 'refused-once')
  await signedIn(page)
  await page.getByRole('link', { name: 'Настройки', exact: true }).click()

  await page.getByRole('button', { name: /Скачать мои данные/ }).click()
  await page.getByRole('button', { name: 'Сохранить или отправить', exact: true }).click()

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __shared: string[] }).__shared))
    .toEqual([expect.stringMatching(/^molvia-.*\.json$/)])
  await expect(page.getByRole('button', { name: 'Сохранить или отправить' })).toHaveCount(0)
})
