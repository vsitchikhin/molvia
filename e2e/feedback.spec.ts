import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { exportFileCodec } from '@molvia/model'
import type { ExportFile } from '@molvia/model'
import { asBrowser, signedIn } from './session'

test.use({ locale: 'ru-RU', reducedMotion: 'reduce' })

/**
 * What the server keeps of this person's messages, read through the copy of their data — the one
 * door to the rows a person has (MOL-93): the suite has no hand in the database.
 */
async function written(page: Page): Promise<ExportFile['feedback']> {
  const response = await page.request.get('/api/actors/me/export', {
    headers: await asBrowser(page),
  })
  expect(response.ok(), `GET /actors/me/export: ${String(response.status())}`).toBe(true)
  return exportFileCodec.parse(await response.json()).feedback
}

/** The sheet, once it is up: until it has risen it deliberately takes no tap at all (MOL-69). */
async function opened(page: Page) {
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await page.waitForTimeout(400)
  return sheet
}

test('from the settings: no kind chosen for the person, and the row is what the sheet showed', async ({
  page,
}) => {
  await signedIn(page, '/settings')
  await page.getByRole('button', { name: 'Написать разработчику' }).click()
  const sheet = await opened(page)
  await expect(sheet.getByRole('heading', { name: 'Написать разработчику' })).toBeVisible()
  await expect(sheet.getByRole('radio', { checked: true })).toHaveCount(0)
  const send = sheet.getByRole('button', { name: 'Выберите, о чём сообщение' })
  await expect(send).toHaveAttribute('aria-disabled', 'true')

  await sheet.getByText('Идея', { exact: true }).click()
  await sheet.getByLabel('Сообщение').fill('Список своих магазинов')
  await expect(sheet.locator('.attached')).toContainText('экран «Настройки»')
  await expect(sheet.locator('.attached')).not.toContainText('код')
  await sheet.getByRole('button', { name: 'Отправить' }).click()

  await expect(sheet.getByText('Спасибо, прочитаем', { exact: true })).toBeVisible()
  await sheet.getByRole('button', { name: 'Готово' }).click()
  await expect(sheet).toBeHidden()
  expect(await written(page)).toMatchObject([
    {
      kind: 'idea',
      text: 'Список своих магазинов',
      locale: 'ru',
      route: 'settings',
      fromError: false,
      errorCode: null,
    },
  ])
})

test('from an error screen: «Сломалось», the screen and the code go with it', async ({ page }) => {
  await page.route('**/api/advice', (route) => route.fulfill({ status: 500, body: '{}' }))
  await signedIn(page, '/')
  await expect(page.getByRole('alert')).toContainText('Сервер не ответил')

  await page.getByRole('button', { name: 'Сообщить о проблеме' }).click()
  const sheet = await opened(page)
  await expect(sheet.getByRole('heading', { name: 'Сообщить о проблеме' })).toBeVisible()
  await expect(sheet.getByRole('radio', { name: 'Сломалось' })).toBeChecked()
  const attached = sheet.locator('.attached')
  await expect(attached).toContainText('экран «Что брать»')
  await expect(attached).toContainText('код error.internal')

  await sheet.getByLabel('Сообщение').fill('Список не загрузился')
  await sheet.getByRole('button', { name: 'Отправить' }).click()
  await expect(sheet.getByText('Спасибо, прочитаем', { exact: true })).toBeVisible()

  expect(await written(page)).toMatchObject([
    {
      kind: 'bug',
      text: 'Список не загрузился',
      route: 'advice',
      fromError: true,
      errorCode: 'error.internal',
    },
  ])
})

// Opened from a link on the screen rather than from one of its own rows, the sheet still takes one
// entry of the history: «back» puts it away and leaves the error screen where it was (сверка С-11).
test('«back» after «Сообщить о проблеме» puts the sheet away, not the screen', async ({ page }) => {
  await page.route('**/api/advice', (route) => route.fulfill({ status: 500, body: '{}' }))
  await signedIn(page, '/')
  await page.getByRole('button', { name: 'Сообщить о проблеме' }).click()
  const sheet = await opened(page)
  await expect(sheet).toBeVisible()

  await page.goBack()

  await expect(sheet).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Что брать')
  await expect(page.getByRole('button', { name: 'Сообщить о проблеме' })).toBeVisible()
})

test('offline the button waits and the text stays; back online it goes', async ({ page }) => {
  await signedIn(page, '/settings')
  await page.getByRole('button', { name: 'Написать разработчику' }).click()
  const sheet = await opened(page)
  await sheet.getByText('Другое', { exact: true }).click()
  await sheet.getByLabel('Сообщение').fill('Написано у полки')

  await page.context().setOffline(true)
  await expect(
    sheet.getByText('Нет связи. Текст сохранён — отправите, когда она появится', { exact: true }),
  ).toBeVisible()
  const waiting = sheet.getByRole('button', { name: 'Отправить можно со связью' })
  await expect(waiting).toHaveAttribute('aria-disabled', 'true')

  // Put away and opened again: the draft is the device's, not the sheet's.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Написать разработчику' }).click()
  await opened(page)
  await expect(sheet.getByLabel('Сообщение')).toHaveValue('Написано у полки')
  await expect(sheet.getByRole('radio', { name: 'Другое' })).toBeChecked()

  await page.context().setOffline(false)
  await sheet.getByRole('button', { name: 'Отправить' }).click()
  await expect(sheet.getByText('Спасибо, прочитаем', { exact: true })).toBeVisible()
  expect(await written(page)).toMatchObject([{ kind: 'other', text: 'Написано у полки' }])
})
