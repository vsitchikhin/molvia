import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type {
  AccountCheckBody,
  AccountCheckResponse,
  AccountJournalResponse,
  AccountsHeldResponse,
  IncomesResponse,
  AccountOperationView,
  MoneyAccountAmendBody,
  MoneyAccountBody,
  MoneyAccountView,
  MoneyAccountsResponse,
  SpendingCategoryView,
  TripView,
} from '@molvia/model'
import AccountSheet from '@/components/AccountSheet.vue'
import HeldFromAccounts from '@/components/HeldFromAccounts.vue'
import IncomeSheet from '@/components/IncomeSheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import ReconcileSheet from '@/components/ReconcileSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import AccountView from '@/views/AccountView.vue'
import AccountsView from '@/views/AccountsView.vue'

const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>()
const accountJournal = vi.fn<(id: string) => Promise<AccountJournalResponse>>()
const addMoneyAccount =
  vi.fn<
    (body: MoneyAccountBody) => Promise<{ accounts: MoneyAccountsResponse; created: boolean }>
  >()
const amendMoneyAccount =
  vi.fn<(id: string, body: MoneyAccountAmendBody) => Promise<MoneyAccountsResponse>>()
const removeMoneyAccount = vi.fn<(id: string) => Promise<MoneyAccountsResponse>>()
const restoreMoneyAccount = vi.fn<(id: string) => Promise<MoneyAccountsResponse>>()
const checkAccount = vi.fn<(id: string, body: AccountCheckBody) => Promise<AccountCheckResponse>>()
const trip = vi.fn<(id: string) => Promise<TripView>>()
const accountsHeld = vi.fn<() => Promise<AccountsHeldResponse>>()
const incomes = vi.fn<() => Promise<IncomesResponse>>()
const recordIncome = vi.fn()
vi.mock('@/api', () => ({
  api: {
    moneyAccounts: () => moneyAccounts(),
    accountJournal: (id: string) => accountJournal(id),
    addMoneyAccount: (body: MoneyAccountBody) => addMoneyAccount(body),
    amendMoneyAccount: (id: string, body: MoneyAccountAmendBody) => amendMoneyAccount(id, body),
    removeMoneyAccount: (id: string) => removeMoneyAccount(id),
    restoreMoneyAccount: (id: string) => restoreMoneyAccount(id),
    checkAccount: (id: string, body: AccountCheckBody) => checkAccount(id, body),
    trip: (id: string) => trip(id),
    accountsHeld: () => accountsHeld(),
    incomes: () => incomes(),
    recordIncome: (body: unknown) => recordIncome(body),
    spendingCategories: () => Promise.resolve({ categories: [] }),
  },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const CASH = '5c1f8b2d-3e4a-4b6c-8d7e-9f0a1b2c3d4e'
const OTHER = 'ffffffff-0000-4000-8000-00000000000d'
const TAXI = 'eeeeeeee-0000-4000-8000-000000000001'

function amd(text: string) {
  const money = parseMoney(text.replace('-', ''), 'AMD')
  return text.startsWith('-') ? { ...money, minor: -money.minor } : money
}
/** «֏60,000» as the balance card of the screen prints it, whatever the spaces. */
const plain = (text: string) => text.replace(/\s/g, ' ')

function cash(patch: Partial<MoneyAccountView> = {}): MoneyAccountView {
  return {
    id: CASH,
    name: 'Cash ֏',
    currency: 'AMD',
    savings: false,
    start: amd('100000'),
    startOn: '2026-09-16',
    balance: amd('100000'),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: true,
    archivedAt: null,
    revision: 1,
    ...patch,
  }
}

function page(accounts: MoneyAccountView[], countedAt = new Date()): MoneyAccountsResponse {
  return {
    spendCurrency: 'AMD',
    accounts,
    totals: { total: amd('0'), spendable: amd('0'), savings: amd('0'), uncounted: 0 },
    unassigned: 0,
    countedAt,
  }
}

function spendingRow(id: string, amount: string, accountId: string | null): AccountOperationView {
  return {
    kind: 'spending',
    id,
    side: null,
    day: '2026-09-27',
    at: new Date('2026-09-27T09:00:00Z'),
    accountId,
    amounts: [amd(amount)],
    moved: accountId ? amd(amount) : null,
    approximate: false,
    debited: null,
    inBalance: true,
    unpriced: 0,
    revision: 1,
    items: null,
    categoryId: OTHER,
    note: 'Taxi',
    place: null,
    source: null,
    counterpart: null,
  }
}

function journal(account: MoneyAccountView, rows: AccountOperationView[]): AccountJournalResponse {
  return { account, rows, cursor: null }
}

const categories: SpendingCategoryView[] = [
  { id: OTHER, preset: 'other', name: null, colour: null, archived: false },
]

let clock = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [
    moneyAccounts,
    accountJournal,
    addMoneyAccount,
    amendMoneyAccount,
    removeMoneyAccount,
    restoreMoneyAccount,
    checkAccount,
    trip,
    accountsHeld,
  ])
    mock.mockReset()
  vi.restoreAllMocks()
  // The sheet takes no tap until it is up (MOL-69): the clock is moved past its rise by hand.
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  trip.mockImplementation(() => new Promise(() => undefined))
})

const views: VueWrapper[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

/** A fresh page load: a new pinia, with whatever the phone kept on its shelf from before. */
function session(): Pinia {
  const pinia = createPinia()
  const actor = useActorStore(pinia)
  actor.id = OWNER
  actor.state = 'ready'
  return pinia
}

async function settle(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  await flushPromises()
}

async function open(component: unknown, path: string, pinia: Pinia, props = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(component as never, {
    props: props as never,
    attachTo: document.body,
    global: { plugins: [router, pinia, createAppI18n('en')] },
  })
  views.push(view)
  await settle()
  return view
}

const button = (view: VueWrapper, text: string | RegExp) =>
  view
    .findAll('button')
    .find((one) => (typeof text === 'string' ? one.text() === text : text.test(one.text())))

function answer(
  fact: string,
  counted: string,
  reasons: AccountCheckResponse['reasons'] = [],
): AccountCheckResponse {
  const factMoney = amd(fact)
  const countedMoney = amd(counted)
  return {
    id: '11111111-0000-4000-8000-000000000001',
    checkedOn: '2026-09-27',
    fact: factMoney,
    counted: countedMoney,
    difference: { ...factMoney, minor: factMoney.minor - countedMoney.minor },
    approximate: false,
    since: '2026-09-16',
    reasons,
  }
}

/**
 * The screens of the accounts against the defects of the review of MR #69 (MOL-123, adversarial А–З,
 * review 16–22): each test is the move that broke them, and the behaviour that holds now.
 */
describe('the account’s screen asks the page again (adversarial А)', () => {
  it('a page kept from an earlier launch gives way to the server’s, and a save goes over its version', async () => {
    useAccountsStore(session()).accept(page([cash()], new Date('2026-09-27T10:05:00Z')))
    const now = cash({ balance: amd('60000'), revision: 2 })
    moneyAccounts.mockResolvedValue(page([now]))
    accountJournal.mockResolvedValue(journal(now, [spendingRow(TAXI, '-40000', CASH)]))
    amendMoneyAccount.mockResolvedValue(page([now]))

    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    expect(moneyAccounts).toHaveBeenCalled()
    expect(plain(view.get('.balance .figure').text())).toContain('60,000')

    await button(view, en.accounts.account.edit)?.trigger('click')
    await settle()
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await settle()
    expect(amendMoneyAccount.mock.calls[0]?.[1].revision).toBe(2)
  })
})

describe('«Править» on an account the page does not hold (review 23, adversarial Б)', () => {
  it('amends the same account, with its currency locked', async () => {
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'down', true))
    accountJournal.mockResolvedValue(journal(cash(), []))
    amendMoneyAccount.mockResolvedValue(page([cash({ name: 'Cash at home' })]))
    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    await button(view, en.accounts.account.edit)?.trigger('click')
    await settle()
    const sheet = view.findComponent(AccountSheet)
    expect(sheet.find('select').exists()).toBe(false)
    await sheet.findAll('input').at(0)?.setValue('Cash at home')
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await settle()
    expect(addMoneyAccount).not.toHaveBeenCalled()
    expect(amendMoneyAccount.mock.calls[0]?.[0]).toBe(CASH)
  })
})

describe('the currency locked while the sheet was open (adversarial Ж)', () => {
  it('goes back to the account’s currency and says why, not «changed elsewhere»', async () => {
    const pinia = session()
    const empty = cash({ hasOperations: false })
    useAccountsStore(pinia).accept(page([empty]))
    amendMoneyAccount.mockRejectedValue(
      new ApiError(ERROR.MONEY_ACCOUNT_CURRENCY_LOCKED, 'lock', true),
    )
    moneyAccounts.mockResolvedValue(page([cash({ hasOperations: true, revision: 2 })]))
    const view = await open(AccountSheet, '/money/accounts', pinia, {
      open: true,
      account: empty,
      spendCurrency: 'AMD',
    })
    await view.get('select').setValue('RUB')
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await settle()
    expect(view.text()).not.toContain(en.accounts.sheet.conflict)
    expect(view.get('.lock').text()).toContain('AMD')
  })
})

describe('«Не попали в остатки» on «Счета» (MOL-159)', () => {
  it('stands under the total and opens the operations with no account', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue({ ...page([cash()]), unassigned: 3 })
    const view = await open(AccountsView, '/money/accounts', pinia)
    const row = view.get('button.unassigned')
    expect(row.text()).toContain('3 entries')
    const total = view.get('.total').element
    expect(
      total.compareDocumentPosition(row.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('must not fire: everything went into a balance — no row', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash()]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    expect(view.find('button.unassigned').exists()).toBe(false)
  })
})

describe('«Вернуть» of a deleted account (adversarial Г)', () => {
  it('stays offered when the answer did not come, goes when it is too late', async () => {
    const pinia = session()
    const store = useAccountsStore(pinia)
    store.accept(page([]))
    store.removed = { id: CASH, name: 'Cash ֏', stamp: Date.now() }
    moneyAccounts.mockResolvedValue(page([]))
    restoreMoneyAccount.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'offline', false))
    const view = await open(AccountsView, '/money/accounts', pinia)
    await button(view, en.accounts.screen.restore)?.trigger('click')
    await settle()
    expect(store.removed).not.toBeNull()
    expect(button(view, en.accounts.screen.restore)).toBeDefined()

    restoreMoneyAccount.mockRejectedValueOnce(new ApiError(ERROR.NOT_FOUND, 'gone', true))
    await button(view, en.accounts.screen.restore)?.trigger('click')
    await settle()
    expect(store.removed).toBeNull()
  })
})

describe('«По счетам · Подставить» (review 22, adversarial Д)', () => {
  it('offers nothing below zero, and a sum above it', async () => {
    const pinia = session()
    useAccountsStore(pinia).accept(page([cash({ currency: 'RUB' })]))
    accountsHeld.mockResolvedValue({
      held: { minor: -740_000n, currency: 'RUB' },
      approximate: false,
    })
    const below = await open(HeldFromAccounts, '/money', pinia, {
      currency: 'RUB',
      day: '2026-09-15',
    })
    expect(below.find('.held').exists()).toBe(false)
    accountsHeld.mockResolvedValue({
      held: { minor: 740_000n, currency: 'RUB' },
      approximate: false,
    })
    const above = await open(HeldFromAccounts, '/money', pinia, {
      currency: 'RUB',
      day: '2026-09-15',
    })
    expect(above.find('.held').exists()).toBe(true)
  })
})

describe('a check and the operations of its reasons', () => {
  async function checkWith(pinia: Pinia, reply: AccountCheckResponse): Promise<VueWrapper> {
    useAccountsStore(pinia).accept(page([cash()]))
    checkAccount.mockResolvedValueOnce(reply)
    const view = await open(ReconcileSheet, '/money/accounts', pinia, {
      open: true,
      account: cash(),
      categories,
      nameOf: () => 'Other',
      accountName: () => null,
    })
    await view.get('input').setValue('10000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await settle()
    return view
  }

  it('a reason removed from its sheet is offered back here, and the difference waits (review 16, З)', async () => {
    const pinia = session()
    const view = await checkWith(
      pinia,
      answer('10000', '11200', [
        { kind: 'unassigned', operation: spendingRow(TAXI, '-1200', null) },
      ]),
    )
    view.findAllComponents(OperationRow).at(0)?.vm.$emit('open')
    await settle()
    view.findComponent(OperationSheet).vm.$emit('removed', {
      undo: { id: TAXI, kind: 'restore' },
      title: 'Taxi',
      amount: '֏1,200',
    })
    await settle()
    expect(button(view, en.spending.restore)).toBeDefined()
    expect(view.text()).toContain(en.accounts.reconcile.recounting)
  })

  it('a difference above zero opens the sheet of an income, filled — nothing written yet (В-5)', async () => {
    const pinia = session()
    incomes.mockResolvedValue({
      base: 'RUB',
      baseSince: null,
      months: [],
      receipts: [],
      heldEstimates: [],
    })
    const view = await checkWith(pinia, answer('10500', '10000'))
    await button(view, /Record the difference/)?.trigger('click')
    await settle()
    const sheet = view.findComponent(IncomeSheet)
    expect(sheet.exists()).toBe(true)
    expect(sheet.props('draft')).toMatchObject({
      amount: amd('500'),
      source: 'other',
      accountId: CASH,
      note: en.accounts.reconcile.note,
    })
    expect(recordIncome).not.toHaveBeenCalled()
  })

  it('round 2, Н3: an income whose answer was lost, opened again, goes under the same name', async () => {
    const pinia = session()
    incomes.mockResolvedValue({
      base: 'AMD',
      baseSince: null,
      months: [],
      receipts: [],
      heldEstimates: [],
    })
    recordIncome.mockReset().mockRejectedValue(new ApiError(ERROR.INTERNAL, 'lost', false))
    const view = await checkWith(pinia, answer('10500', '10000'))
    for (let opening = 0; opening < 2; opening += 1) {
      await button(view, /Record the difference/)?.trigger('click')
      await settle()
      await button(view, en.income.sheet.save)?.trigger('click')
      await settle()
      view.findComponent(IncomeSheet).vm.$emit('update:open', false)
      await settle()
    }
    const [first, second] = recordIncome.mock.calls.map(([body]) => (body as { id: string }).id)
    expect(recordIncome).toHaveBeenCalledTimes(2)
    expect(second).toBe(first)
  })
})

// The phone's today (MOL-121): at 20:30 UTC, the zone the tests run in, it is the 28th here and the
// 29th in Yerevan — where the two part, and where a day of Yerevan would show.
describe('the phone’s day on the accounts (MOL-121)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T20:30:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a new account starts on the phone’s today, and no later (Т-3)', async () => {
    const view = await open(AccountSheet, '/money/accounts', session(), {
      open: true,
      spendCurrency: 'AMD',
    })
    await settle()
    const day = view.get('input[type="date"]').element as HTMLInputElement
    expect(day.value).toBe('2026-09-28')
    expect(day.max).toBe('2026-09-28')
  })

  it('the journal says «Today» of the phone’s day, and «Yesterday» once its midnight is past (Т-3, adversarial Н)', async () => {
    moneyAccounts.mockResolvedValue(page([cash()]))
    accountJournal.mockResolvedValue(
      journal(cash(), [{ ...spendingRow(TAXI, '-1200', CASH), day: '2026-09-28' }]),
    )
    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    await settle()
    expect(view.text()).toContain('Today · September 28')

    vi.setSystemTime(new Date('2026-09-29T00:20:00Z'))
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(view.text()).toContain('Yesterday · September 28')
  })
})
