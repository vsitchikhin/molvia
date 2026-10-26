// MOL-295, адверсариальное ревью, раунд 1, А5: прогон длиннее `timeout-minutes: 40` отменяется,
// и `if: failure()` не выгружает трейсы, которые Playwright уже записал. Гоняется в CI на ветке
// MOL-295-mutations: этот файл — e2e/MOL-295-attack.spec.ts, `test:e2e` сужен до него в проекте phone,
// предел задания не тронут (40 мин). Дефект жив, если задание кончилось «cancelled», шаг
// upload-artifact — «skipped», а в логе нет ни строки «1 failed», ни ошибки первого теста.
import { expect, test } from '@playwright/test'

test('А5: падает сразу, со второй попытки пишет трейс', async ({ page }) => {
  await page.goto('/')
  expect('трейс этой попытки должен уйти в артефакт').toBe('ушёл')
})

test('А5: висит, пока задание не снимут по пределу', async () => {
  test.setTimeout(0)
  await new Promise(() => {})
})
