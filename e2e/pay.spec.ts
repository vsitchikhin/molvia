import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ffOff, signedIn } from './session'

// Payment by card on the phone (MOL-277), behind the фф `payments`: the suite's API has it on, and its «off» on the
// phone is `ffOff`. **No payment starts here, and that is the run's price, named**: end-to-end keeps no rate of the
// CBA (`RATES_REFRESH=off`) — `money.spec` holds the dollars «не посчитано» on it — so the screen of payment says
// it has no price, as it does on a day the CBA is silent. The way to the bank and back is the integration test's
// (`payments-routes.integration.test.ts`, a channel of the test's) and the components' (`PayView`, `PayDoneView`).
// **WebKit is not run** (`iphone`): it keeps no `Secure` cookie on the loopback and opens no screen of a person.

test('the settings’ row opens the screen of payment, receipts chosen, and with no rate today it says so', async ({
  page,
}) => {
  await signedIn(page, '/settings')
  const row = page.locator('a.list-row').filter({ hasText: 'Receipt reading' })
  await expect(row).toHaveAttribute('href', '/pay?tariff=receipts')

  await row.click()

  await expect(page).toHaveURL(/\/pay\?tariff=receipts$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Payment')
  await expect(page.getByRole('heading', { name: 'Payment is closed for now' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Pay by card/ })).toHaveCount(0)
})

test('the bank’s way back to a payment that is none of the person’s says «no such payment», never an error', async ({
  page,
}) => {
  await signedIn(page, `/pay/done/${randomUUID()}?orderID=1042&resposneCode=00`)
  await expect(page.getByRole('heading', { name: 'No such payment' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Paid' })).toHaveCount(0)
})

test('off, payment is nowhere: the row a status with no chevron, the screen an address that leads home', async ({
  page,
}) => {
  await ffOff(page, ['payments'])
  await signedIn(page, '/settings')
  const row = page.locator('.list-row').filter({ hasText: 'Receipt reading' })
  await expect(row).toBeVisible()
  await expect(page.locator('a.list-row').filter({ hasText: 'Receipt reading' })).toHaveCount(0)

  await page.goto('/pay')
  await expect(page).toHaveURL(/\/$/)
})
