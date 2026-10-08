import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type {
  Currency,
  MoneyAccountView,
  MoneyAccountsResponse,
  TransferAmendBody,
  TransferBody,
  TransferResponse,
  TransferView,
} from '@molvia/model'
import TransferSheet from './TransferSheet.vue'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'

const recordTransfer =
  vi.fn<(body: TransferBody) => Promise<{ transfer: TransferResponse; created: boolean }>>()
const amendTransfer = vi.fn<(id: string, body: TransferAmendBody) => Promise<TransferResponse>>()
const removeTransfer = vi.fn<(id: string) => Promise<MoneyAccountsResponse>>()
const transfer = vi.fn<(id: string) => Promise<TransferView>>()
const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>()
vi.mock('@/api', () => ({
  api: {
    recordTransfer: (body: TransferBody) => recordTransfer(body),
    amendTransfer: (id: string, body: TransferAmendBody) => amendTransfer(id, body),
    removeTransfer: (id: string) => removeTransfer(id),
    transfer: (id: string) => transfer(id),
    moneyAccounts: () => moneyAccounts(),
  },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const TRANSFER = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
let next = 0

function account(name: string, currency: Currency): MoneyAccountView {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    name,
    currency,
    savings: false,
    start: parseMoney('0', currency),
    startOn: '2026-09-16',
    balance: parseMoney('3140', currency),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: null,
    revision: 1,
  }
}

const card = account('Dad’s card', 'USD')
const dollars = account('Dollars', 'USD')
const cash = account('Cash', 'AMD')

function page(accounts: MoneyAccountView[]): MoneyAccountsResponse {
  const zero = parseMoney('0', 'AMD')
  return {
    spendCurrency: 'AMD',
    accounts,
    totals: { total: zero, spendable: zero, savings: zero, uncounted: 0 },
    unassigned: 0,
    countedAt: new Date(),
  }
}

function written(patch: Partial<TransferView> = {}): TransferView {
  return {
    id: TRANSFER,
    fromAccountId: card.id,
    toAccountId: dollars.id,
    amount: parseMoney('2000', 'USD'),
    fee: parseMoney('20', 'USD'),
    transferredOn: '2026-10-08',
    note: null,
    revision: 1,
    amendedAt: null,
    ...patch,
  }
}

function withAccounts(accounts: MoneyAccountView[]): Pinia {
  const pinia = createPinia()
  const actor = useActorStore(pinia)
  actor.id = OWNER
  actor.state = 'idle'
  useAccountsStore(pinia).accept(page(accounts))
  return pinia
}

let clock = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [recordTransfer, amendTransfer, removeTransfer, transfer, moneyAccounts]) {
    mock.mockReset()
  }
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function sheet(props: Record<string, unknown>, pinia: Pinia): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/accounts')
  const view = mount(TransferSheet, {
    props: { open: true, ...props } as never,
    attachTo: document.body,
    global: { plugins: [router, pinia, createAppI18n('en')] },
  })
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

/** «Перевести» — the large button of the footer, whatever it says now. */
const mainButton = (view: VueWrapper) => view.get('.footer button.large')
const row = (view: VueWrapper, label: string) => {
  const found = view
    .findAll('button[aria-haspopup="dialog"]')
    .find((one) => one.find('.label').exists() && one.get('.label').text().endsWith(label))
  if (!found) throw new Error(`no row «${label}»`)
  return found
}

async function typeAmount(view: VueWrapper, text: string): Promise<void> {
  await view.get('input.entry').setValue(text)
}

describe('TransferSheet (MOL-253)', () => {
  it('opens on the account it came from, with the one target of its currency put in (Р-6)', async () => {
    const view = await sheet({ from: card.id }, withAccounts([card, dollars, cash]))
    expect(row(view, 'From').text()).toContain('Dad’s card')
    expect(row(view, 'To').text()).toContain('Dollars')
    expect(mainButton(view).text()).toBe('Enter the amount')
    await typeAmount(view, '2000')
    expect(mainButton(view).text()).toContain('Transfer')
    expect(mainButton(view).text()).toContain('2')
    expect(mainButton(view).attributes('aria-disabled')).toBeUndefined()
  })

  it('says what it still needs, in order, and stays in focus (Ф-6)', async () => {
    const savings = account('Savings', 'USD')
    const none = await sheet({ from: null }, withAccounts([card, dollars, savings, cash]))
    expect(mainButton(none).text()).toBe('Choose where from')
    expect(mainButton(none).attributes('aria-disabled')).toBe('true')
    expect(row(none, 'To').attributes('aria-disabled')).toBe('true')

    const alone = await sheet({ from: cash.id }, withAccounts([card, dollars, savings, cash]))
    expect(mainButton(alone).text()).toBe('Needs a second account in drams')
    expect(alone.text()).toContain('No other account in drams')

    const two = await sheet({ from: card.id }, withAccounts([card, dollars, savings, cash]))
    expect(mainButton(two).text()).toBe('Enter the amount')
    await typeAmount(two, '100')
    expect(mainButton(two).text()).toBe('Choose where to')
  })

  it('offline: one yellow line, the button says it waits, nothing is sent', async () => {
    const view = await sheet({ from: card.id, online: false }, withAccounts([card, dollars]))
    expect(view.text()).toContain('No connection. You can transfer once online')
    await typeAmount(view, '2000')
    expect(mainButton(view).text()).toBe('We’ll transfer once online'.replace('’', "'"))
    await mainButton(view).trigger('click')
    expect(recordTransfer).not.toHaveBeenCalled()
  })

  it('sends the sum, the fee and the day under one name — the same again after a failure', async () => {
    const pinia = withAccounts([card, dollars])
    recordTransfer
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'offline', false))
      .mockResolvedValueOnce({
        transfer: { transfer: written(), accounts: page([card, dollars]) },
        created: true,
      })
    const view = await sheet({ from: card.id }, pinia)
    await typeAmount(view, '2000')
    const fee = view
      .findAll('input')
      .find((one) => one.attributes('inputmode') === 'decimal' && !one.classes('entry'))
    await fee?.setValue('20')
    expect(view.text()).toContain('leaves in all')
    await mainButton(view).trigger('click')
    await flushPromises()
    expect(view.text()).toContain('The transfer didn')
    await mainButton(view).trigger('click')
    await flushPromises()
    const [first, second] = recordTransfer.mock.calls.map(([body]) => body)
    expect(first).toMatchObject({
      fromAccountId: card.id,
      toAccountId: dollars.id,
      amount: { minor: 200_000n, currency: 'USD' },
      fee: { minor: 2_000n, currency: 'USD' },
    })
    expect(second?.id).toBe(first?.id)
    expect(view.emitted('done')).toEqual([[{ kind: 'saved', transfer: written(), created: true }]])
  })

  it('an account gone on another phone empties «Куда», marks it and keeps what was typed', async () => {
    const savings = account('Savings', 'USD')
    const pinia = withAccounts([card, dollars, savings])
    recordTransfer.mockRejectedValueOnce(new ApiError(ERROR.TRANSFER_ACCOUNT, 'gone', true))
    moneyAccounts.mockResolvedValueOnce(page([card, savings]))
    const view = await sheet({ from: card.id }, pinia)
    await typeAmount(view, '2000')
    await row(view, 'To').trigger('click')
    await flushPromises()
    // Past the moment the picker rises: until then it takes no tap at all.
    clock += 2000
    await new Promise((resolve) => setTimeout(resolve, 5))
    const option = document.body.querySelector<HTMLButtonElement>(
      `button[role="radio"]:not([aria-checked="true"])`,
    )
    expect(option?.textContent).toContain('Dollars')
    option?.click()
    await flushPromises()
    await mainButton(view).trigger('click')
    await flushPromises()
    expect(view.text()).toContain('«Dollars» was deleted on another phone')
    expect(row(view, 'To').attributes('aria-invalid')).toBe('true')
    expect((view.get('input.entry').element as HTMLInputElement).value).toBe('2000')
  })

  it('amends what it opened on and removes it with its fee', async () => {
    const pinia = withAccounts([card, dollars])
    transfer.mockResolvedValue(written({ amendedAt: new Date('2026-10-08T10:00:00Z') }))
    removeTransfer.mockResolvedValue(page([card, dollars]))
    const view = await sheet({ editingId: TRANSFER }, pinia)
    expect(view.text()).toContain('Edit transfer')
    expect(view.text()).toContain('edited')
    expect(mainButton(view).text()).toBe('Save')
    const remove = view.findAll('button').find((one) => one.text() === 'Delete transfer')
    await remove?.trigger('click')
    await flushPromises()
    expect(removeTransfer).toHaveBeenCalledWith(TRANSFER)
    expect(view.emitted('done')?.[0]).toEqual([
      { kind: 'removed', transfer: written({ amendedAt: new Date('2026-10-08T10:00:00Z') }) },
    ])
  })
})
