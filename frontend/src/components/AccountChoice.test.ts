import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseMoney } from '@molvia/model'
import type {
  AccountsHeldResponse,
  Currency,
  IncomeBody,
  IncomesResponse,
  MoneyAccountView,
  MoneyAccountsResponse,
  SpendingCategoryView,
} from '@molvia/model'
import AccountPickerSheet from './AccountPickerSheet.vue'
import IncomeSheet from './IncomeSheet.vue'
import SpendingSheet from './SpendingSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const accountsHeld = vi.fn<() => Promise<AccountsHeldResponse>>()
vi.mock('@/api', () => ({ api: { accountsHeld: () => accountsHeld() } }))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const CAFE = 'ffffffff-0000-4000-8000-000000000003'
let next = 0

function account(
  name: string,
  currency: Currency,
  patch: Partial<MoneyAccountView> = {},
): MoneyAccountView {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    name,
    currency,
    savings: false,
    start: parseMoney('0', currency),
    startOn: '2026-09-16',
    balance: parseMoney('1000', currency),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: null,
    revision: 1,
    ...patch,
  }
}

const cash = account('Cash ֏', 'AMD')
const card = account('Card ₽', 'RUB')
const old = account('Old card ₽', 'RUB', { archivedAt: new Date('2026-09-21') })

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

/** A pinia whose owner has these accounts, as the page last answered them. */
function withAccounts(accounts: MoneyAccountView[]): Pinia {
  const pinia = createPinia()
  const actor = useActorStore(pinia)
  actor.id = OWNER
  actor.state = 'idle'
  useAccountsStore(pinia).accept(page(accounts))
  return pinia
}

const categories: SpendingCategoryView[] = [
  { id: CAFE, preset: 'cafe', name: null, colour: null, archived: false },
]

let clock = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  accountsHeld.mockReset().mockResolvedValue({ held: null, approximate: false })
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function mounted(
  component: unknown,
  props: Record<string, unknown>,
  pinia: Pinia,
): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money')
  const view = mount(component as never, {
    props: props as never,
    attachTo: document.body,
    global: { plugins: [router, pinia, createAppI18n('en')] },
  })
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

const accountRow = (view: VueWrapper) =>
  view.findAll('button[aria-haspopup="dialog"]').find((one) => one.text().includes('Account'))

async function spendingSheet(pinia: Pinia): Promise<VueWrapper> {
  return mounted(
    SpendingSheet,
    {
      open: true,
      target: { kind: 'add' },
      categories,
      nameOf: () => 'Cafe',
      spendCurrency: 'AMD',
    },
    pinia,
  )
}

async function currency(view: VueWrapper, value: Currency): Promise<void> {
  await view.get(`input[type="radio"][value="${value}"]`).setValue(true)
  await flushPromises()
}

describe('the account in the sheet of a spending (handoff 06)', () => {
  it('no account at all — no row, and the spending is written without one', async () => {
    const pinia = withAccounts([])
    const view = await spendingSheet(pinia)
    expect(accountRow(view)).toBeUndefined()
    await view.get('input[inputmode="decimal"]').setValue('2500')
    await view.get(`input[type="radio"][value="${CAFE}"]`).setValue(true)
    await view
      .findAll('button')
      .find((one) => one.text() === en.spending.sheet.save)
      ?.trigger('click')
    const [write] = useSpendingQueueStore(pinia).pending
    expect(write?.kind).toBe('record')
    expect(write?.kind === 'record' && 'accountId' in write.body).toBe(false)
  })

  it('starts on the first live account of its currency, and follows the currency until chosen', async () => {
    const pinia = withAccounts([old, cash, card])
    const view = await spendingSheet(pinia)
    expect(accountRow(view)?.text()).toContain('Cash ֏')
    await currency(view, 'RUB')
    // The removed card is never offered, though it came first.
    expect(accountRow(view)?.text()).toContain('Card ₽')
    await currency(view, 'EUR')
    expect(accountRow(view)?.text()).toContain(en.accounts.picker.none)
  })

  it('«Списано» for an account in another currency; its sum goes with the spending', async () => {
    const pinia = withAccounts([cash, card])
    const view = await spendingSheet(pinia)
    expect(view.text()).not.toContain('Charged to the account')
    // The person picks the rouble card for a spending in drams: the choice holds.
    const picker = view.findComponent(AccountPickerSheet)
    picker.vm.$emit('pick', card.id)
    await flushPromises()
    await currency(view, 'AMD')
    expect(accountRow(view)?.text()).toContain('Card ₽')
    const charged = view.findAll('.charged input')
    expect(charged).toHaveLength(1)
    await charged[0]?.setValue('2140.91')
    await view.get('.well input').setValue('9891')
    await view.get(`input[type="radio"][value="${CAFE}"]`).setValue(true)
    await view
      .findAll('button')
      .find((one) => one.text() === en.spending.sheet.save)
      ?.trigger('click')
    const [write] = useSpendingQueueStore(pinia).pending
    expect(write?.kind === 'record' && write.body).toMatchObject({
      accountId: card.id,
      debited: { minor: 214_091n, currency: 'RUB' },
    })
  })

  it('«Без счёта» is said out loud — an explicit null, not a field left out', async () => {
    const pinia = withAccounts([cash])
    const view = await spendingSheet(pinia)
    view.findComponent(AccountPickerSheet).vm.$emit('pick', null)
    await flushPromises()
    await view.get('.well input').setValue('500')
    await view.get(`input[type="radio"][value="${CAFE}"]`).setValue(true)
    await view
      .findAll('button')
      .find((one) => one.text() === en.spending.sheet.save)
      ?.trigger('click')
    const [write] = useSpendingQueueStore(pinia).pending
    expect(write?.kind === 'record' && write.body).toMatchObject({ accountId: null, debited: null })
  })
})

describe('the account of an income: its own currency only, and no «Списано»', () => {
  const overview: IncomesResponse = {
    base: 'RUB',
    baseSince: null,
    months: [],
    receipts: [],
    heldEstimates: [],
  }

  it('offers only accounts of the income’s currency and writes the one chosen', async () => {
    const record = vi.fn<(body: IncomeBody) => Promise<unknown>>().mockResolvedValue(undefined)
    const pinia = withAccounts([cash, card])
    const view = await mounted(
      IncomeSheet,
      { open: true, overview, record, amend: vi.fn(), editing: null },
      pinia,
    )
    const row = view
      .findAll('button[aria-haspopup="dialog"]')
      .find((one) => one.text().includes(en.accounts.picker.row_income))
    expect(row?.text()).toContain('Card ₽')
    const picker = view.findComponent(AccountPickerSheet)
    expect(picker.props()).toMatchObject({ currency: 'RUB', strict: true })
    expect(view.text()).not.toContain('Charged to the account')
    const amount = view.findAll('.field').find((one) => one.text().includes(en.income.sheet.amount))
    await amount?.get('input').setValue('99615')
    const source = view.findAll('.field').find((one) => one.text().includes(en.income.sheet.source))
    await source?.get('select').setValue('salary')
    await view
      .findAll('button')
      .find((one) => one.text() === en.income.sheet.save)
      ?.trigger('click')
    await flushPromises()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ accountId: card.id }))
  })
})

describe('an amendment moved to another currency (review 11)', () => {
  it('an income moved to another currency leaves an account that cannot hold it', async () => {
    const dollars = account('Dollars', 'USD')
    const pinia = withAccounts([card, dollars])
    const view = await mounted(
      IncomeSheet,
      {
        open: true,
        overview: { base: 'RUB', baseSince: null, months: [], receipts: [], heldEstimates: [] },
        record: vi.fn(),
        amend: vi.fn(),
        editing: {
          id: '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
          receivedOn: '2026-09-15',
          amount: { minor: 9_961_500n, currency: 'RUB' },
          heldBefore: null,
          source: 'salary',
          note: null,
          accountId: card.id,
          revision: 1,
          amendedAt: null,
          history: [],
        },
      },
      pinia,
    )
    const row = () =>
      view
        .findAll('button[aria-haspopup="dialog"]')
        .find((one) => one.text().includes(en.accounts.picker.row_income))
    expect(row()?.text()).toContain('Card ₽')
    const currencyField = view
      .findAll('.field')
      .find((one) => one.text().includes(en.income.sheet.currency))
    await currencyField?.get('select').setValue('USD')
    await flushPromises()
    expect(row()?.text()).toContain('Dollars')
  })
})

describe('the account of a trip from its summary (review 1, 2)', () => {
  it('a choice goes into the trip’s queue at once and says so; a look sends nothing', async () => {
    const pinia = withAccounts([cash, card])
    const trip = vi.fn()
    const { api } = await import('@/api')
    ;(api as unknown as Record<string, unknown>).trip = trip
    trip.mockResolvedValue({
      id: 'bbbbbbbb-0000-4000-8000-000000000001',
      accountId: cash.id,
      debited: null,
      currency: 'AMD',
      expenses: [],
    })
    const view = await mounted(
      SpendingSheet,
      {
        open: true,
        target: {
          kind: 'trip',
          day: '2026-09-25',
          row: {
            kind: 'trip',
            key: 'bbbbbbbb-0000-4000-8000-000000000001',
            tripId: 'bbbbbbbb-0000-4000-8000-000000000001',
            placeName: 'SAS',
            items: 2,
            amount: parseMoney('3480', 'AMD'),
            counted: null,
          },
        },
        categories,
        nameOf: () => 'Groceries',
        spendCurrency: 'AMD',
      },
      pinia,
    )
    await flushPromises()
    const { useTripQueueStore } = await import('@/stores/tripQueue')
    const queue = useTripQueueStore(pinia)
    expect(queue.pending).toEqual([])
    view.findComponent(AccountPickerSheet).vm.$emit('pick', card.id)
    await flushPromises()
    expect(queue.pending).toEqual([
      {
        kind: 'payment',
        tripId: 'bbbbbbbb-0000-4000-8000-000000000001',
        body: { accountId: card.id, debited: null },
      },
    ])
    expect(view.emitted('paid')).toHaveLength(1)
  })
})

describe('AccountPickerSheet', () => {
  it('a strict picker with nothing of the currency says the operation goes without one', async () => {
    const view = await mounted(
      AccountPickerSheet,
      { open: true, title: 'Account', accounts: [cash], currency: 'USD', strict: true },
      withAccounts([cash]),
    )
    expect(view.text()).not.toContain('Cash ֏')
    expect(view.text()).toContain(en.accounts.picker.none)
    expect(view.findAll('[role="radio"]')).toHaveLength(1)
  })

  it('a loose one lists the other currencies, with their balances, below the own', async () => {
    const view = await mounted(
      AccountPickerSheet,
      {
        open: true,
        title: 'Account',
        accounts: [card, cash, old],
        currency: 'AMD',
        selected: cash.id,
      },
      withAccounts([cash]),
    )
    const names = view.findAll('[role="radio"]').map((one) => one.text())
    expect(names[0]).toContain('Cash ֏')
    expect(names[1]).toContain('Card ₽')
    expect(names.join()).not.toContain('Old card')
    expect(view.get('[aria-checked="true"]').text()).toContain('Cash ֏')
  })
})
