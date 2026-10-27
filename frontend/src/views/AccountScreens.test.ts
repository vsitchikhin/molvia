import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { nextTick, shallowRef } from 'vue'
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
import AppReveal from '@/components/AppReveal.vue'
import HeldFromAccounts from '@/components/HeldFromAccounts.vue'
import IncomeSheet from '@/components/IncomeSheet.vue'
import OperationRow from '@/components/OperationRow.vue'
import OperationSheet from '@/components/OperationSheet.vue'
import ReconcileSheet from '@/components/ReconcileSheet.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { pwaUpdateKey } from '@/pwaUpdate'
import type { PwaUpdate, UpdatePhase } from '@/pwaUpdate'
import { routes } from '@/router'
import { rememberJournal, useAccountsStore } from '@/stores/accounts'
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
const THIRD = 'ffffffff-0000-4000-8000-00000000000e'
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
    incomeTotals: null,
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
    transferId: null,
  }
}

function journal(account: MoneyAccountView, rows: AccountOperationView[]): AccountJournalResponse {
  return { account, rows, cursor: null }
}

const categories: SpendingCategoryView[] = [
  { id: OTHER, preset: 'other', name: null, colour: null, icon: null, archived: false },
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

async function open(
  component: unknown,
  path: string,
  pinia: Pinia,
  props = {},
  update?: PwaUpdate,
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(component as never, {
    props: props as never,
    attachTo: document.body,
    global: {
      plugins: [router, pinia, createAppI18n('en')],
      provide: update ? { [pwaUpdateKey as symbol]: update } : {},
    },
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

describe('the ways into «Перевод» (MOL-253, handoff 01)', () => {
  const second = cash({ id: '22222222-0000-4000-8000-000000000002', name: 'Card ֏' })
  const dollars = cash({
    id: '33333333-0000-4000-8000-000000000003',
    name: 'Dollars',
    currency: 'USD',
  })

  it('«Счета» offers it under the total while some currency has two live accounts', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash(), second]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    const row = button(view, /Transfer between accounts/)
    expect(row?.attributes('aria-haspopup')).toBe('dialog')
  })

  it('must not fire: one account a currency, or the second one removed — no way in', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(
      page([cash(), dollars, { ...second, archivedAt: new Date('2026-10-01') }]),
    )
    const view = await open(AccountsView, '/money/accounts', pinia)
    expect(button(view, /Transfer between accounts/)).toBeUndefined()
  })

  it('an account’s screen offers «Перевести» under «Сверить» only with a second of its currency', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash(), second, dollars]))
    accountJournal.mockResolvedValue(journal(cash(), []))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    expect(button(view, 'Transfer')).toBeDefined()

    moneyAccounts.mockResolvedValue(page([cash(), dollars]))
    const alone = await open(AccountView, `/money/accounts/${CASH}`, session())
    expect(button(alone, 'Transfer')).toBeUndefined()
  })
})

describe('«Счета» on the kit (MOL-193)', () => {
  const add = (view: VueWrapper) => button(view, en.accounts.screen.add)
  const offline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const rub = (text: string) => parseMoney(text, 'RUB')

  function twoCurrencies(): MoneyAccountsResponse {
    return {
      ...page([cash()]),
      totals: {
        total: amd('3559833'),
        spendable: amd('217486'),
        savings: amd('3342347'),
        uncounted: 0,
      },
      incomeTotals: {
        currency: 'RUB',
        total: rub('770527'),
        spendable: rub('47075'),
        savings: rub('723452'),
        uncounted: 0,
      },
    }
  }

  it('«Добавить счёт» is the strip over an answer: with accounts, and on the empty screen with no button of its own', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash()]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    expect(view.get('.dock').text()).toContain(en.accounts.screen.add)

    const empty = session()
    moneyAccounts.mockResolvedValue(page([]))
    const bare = await open(AccountsView, '/money/accounts', empty)
    expect(bare.get('.dock').text()).toContain(en.accounts.screen.add)
    expect(bare.getComponent(ScreenState).findAll('button')).toHaveLength(0)
  })

  it('must not fire: no strip on the skeleton, and the error takes it with «Повторить»', async () => {
    const pinia = session()
    moneyAccounts.mockImplementation(() => new Promise(() => undefined))
    const view = await open(AccountsView, '/money/accounts', pinia)
    expect(view.find('.skeleton-figure').exists()).toBe(true)
    expect(add(view)).toBeUndefined()

    const broken = session()
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await open(AccountsView, '/money/accounts', broken)
    expect(add(failed)).toBeUndefined()
    expect(failed.get('.dock').text()).toContain(en.state.retry)
  })

  it('a removal leaves «Добавить счёт» under «Вернуть», which waits for the connection offline', async () => {
    const pinia = session()
    const store = useAccountsStore(pinia)
    moneyAccounts.mockResolvedValue(page([cash()]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    store.removed = { id: OTHER, name: 'Card ₽', stamp: Date.now() }
    await settle()
    expect(view.findComponent(UndoStrip).exists()).toBe(true)
    expect(add(view)).toBeDefined()
    expect(view.getComponent(UndoStrip).props('waiting')).toBe(false)

    offline()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(view.getComponent(UndoStrip).props('waiting')).toBe(true)
    expect(view.getComponent(UndoStrip).props('waitingAction')).toBe(
      en.accounts.screen.restore_wait,
    )
  })

  it('the total in the income currency large and the spending one under it, the tiles too (В-19, В-1 «б»)', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(twoCurrencies())
    const view = await open(AccountsView, '/money/accounts', pinia)
    expect(plain(view.get('.figure').text())).toMatch(/770,527/)
    expect(view.get('.figure').text()).toContain('₽')
    expect(plain(view.get('.figure-second').text())).toMatch(/3,559,833/)
    const tiles = view.findAll('.tile')
    expect(plain(tiles[0]?.get('.tile-figure').text() ?? '')).toMatch(/47,075/)
    expect(plain(tiles[0]?.get('.tile-second').text() ?? '')).toMatch(/217,486/)
    expect(plain(tiles[1]?.get('.tile-figure').text() ?? '')).toMatch(/723,452/)
    expect(plain(tiles[1]?.get('.tile-second').text() ?? '')).toMatch(/3,342,347/)
  })

  it('one currency, or a page kept from before `incomeTotals` — one figure, no line under it', async () => {
    const same = session()
    const one = twoCurrencies()
    moneyAccounts.mockResolvedValue({ ...one, incomeTotals: { ...one.totals, currency: 'AMD' } })
    const view = await open(AccountsView, '/money/accounts', same)
    expect(plain(view.get('.figure').text())).toMatch(/3,559,833/)
    expect(view.find('.figure-second').exists()).toBe(false)
    expect(view.find('.tile-second').exists()).toBe(false)

    const old = session()
    moneyAccounts.mockResolvedValue({ ...one, incomeTotals: null })
    const kept = await open(AccountsView, '/money/accounts', old)
    expect(plain(kept.get('.figure').text())).toMatch(/3,559,833/)
    expect(kept.find('.figure-second').exists()).toBe(false)
  })

  it('below zero each figure by its own sign', async () => {
    const pinia = session()
    const two = twoCurrencies()
    moneyAccounts.mockResolvedValue({
      ...two,
      totals: { ...two.totals, spendable: amd('-5000') },
      incomeTotals: two.incomeTotals && {
        ...two.incomeTotals,
        spendable: { ...rub('1082'), minor: -108225n },
      },
    })
    const view = await open(AccountsView, '/money/accounts', pinia)
    const tile = view.findAll('.tile')[0]
    expect(tile?.get('.tile-figure').classes()).toContain('negative')
    expect(tile?.get('.tile-second').classes()).toContain('negative')
    expect(view.get('.figure').classes()).not.toContain('negative')
    expect(view.findAll('.tile')[1]?.find('.negative').exists()).toBe(false)

    // The savings too — a card in debt among them, a start below zero (adversarial А1).
    const savings = session()
    moneyAccounts.mockResolvedValue({
      ...two,
      totals: { ...two.totals, savings: amd('-5000') },
      incomeTotals: two.incomeTotals && {
        ...two.incomeTotals,
        savings: { ...rub('1082'), minor: -108225n },
      },
    })
    const saved = (await open(AccountsView, '/money/accounts', savings)).findAll('.tile')[1]
    expect(saved?.get('.tile-figure').classes()).toContain('negative')
    expect(saved?.get('.tile-second').classes()).toContain('negative')
  })

  it('must not fire: either currency left an account out — one figure, and the note says what it misses (Р1-1)', async () => {
    const two = twoCurrencies()
    // No rate between the two: the drams are in the drams' figure alone, the roubles in theirs.
    for (const [income, spend] of [
      [1, 1],
      [0, 1],
      [1, 0],
    ] as const) {
      moneyAccounts.mockResolvedValue({
        ...two,
        totals: { ...two.totals, uncounted: spend },
        incomeTotals: two.incomeTotals && { ...two.incomeTotals, uncounted: income },
      })
      const view = await open(AccountsView, '/money/accounts', session())
      expect(view.get('.figure').text()).toContain('₽')
      expect(view.find('.figure-second').exists()).toBe(false)
      expect(view.find('.tile-second').exists()).toBe(false)
      expect(view.text().includes('not counted')).toBe(income > 0)
    }
  })

  it('an account is a row of the kit to its screen, «≈» only beside a foreign balance', async () => {
    const pinia = session()
    const card = cash({
      id: OTHER,
      name: 'Card ₽',
      currency: 'RUB',
      balance: rub('515.81'),
      inSpend: amd('2383'),
    })
    moneyAccounts.mockResolvedValue(page([cash(), card]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    const rows = view.findAll('a.list-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.attributes('href')).toBe(`/money/accounts/${CASH}`)
    expect(rows[0]?.find('.approx').exists()).toBe(false)
    expect(plain(rows[1]?.get('.approx').text() ?? '')).toMatch(/2,383/)
  })

  it('a removed account offline: «Вернуть» not now and saying why, the way to its screen open', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash(), cash({ id: OTHER, archivedAt: new Date() })]))
    offline()
    const view = await open(AccountsView, '/money/accounts', pinia)
    await view.get('.removed-head').trigger('click')
    await settle()
    const restore = button(view, en.accounts.screen.restore_wait)
    expect(restore?.attributes('aria-disabled')).toBe('true')
    await restore?.trigger('click')
    expect(restoreMoneyAccount).not.toHaveBeenCalled()
    expect(view.get('.removed-open').attributes('href')).toBe(`/money/accounts/${OTHER}`)
  })

  it("the connection in one strip of the screen's words; a failed retry says the same words again", async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash()]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    expect(view.findComponent(StatusStrip).exists()).toBe(false)

    // Kept from an earlier launch: this one has not had an answer.
    useAccountsStore(session()).accept(page([cash()], new Date('2026-09-26T10:05:00Z')))
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const stale = await open(AccountsView, '/money/accounts', session())
    const strip = stale.getComponent(StatusStrip)
    expect(strip.props('kind')).toBe('unanswered')
    const before = strip.props('attempt') as number
    await button(stale, en.state.retry)?.trigger('click')
    await settle()
    expect(stale.getComponent(StatusStrip).props('attempt')).toBe(before + 1)

    offline()
    window.dispatchEvent(new Event('offline'))
    await settle()
    // One on the screen: a closed sheet's own strip is the sheet's.
    const onScreen = stale
      .findAllComponents(StatusStrip)
      .filter((one) => !one.element.closest('dialog'))
    expect(onScreen.map((one) => one.props('kind'))).toEqual(['offline'])
  })

  it('answered in this session, then a read that failed: the same strip, as «Деньги» date the same money (adversarial А2)', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash()], new Date('2026-10-23T09:05:00Z')))
    const first = await open(AccountsView, '/money/accounts', pinia)
    views.splice(views.indexOf(first), 1)
    first.unmount()

    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const again = await open(AccountsView, '/money/accounts', pinia)
    expect(again.getComponent(StatusStrip).props('kind')).toBe('unanswered')
    expect(button(again, en.state.retry)).toBeDefined()

    // An answer takes it away.
    moneyAccounts.mockResolvedValue(page([cash()]))
    await button(again, en.state.retry)?.trigger('click')
    await settle()
    expect(again.findComponent(StatusStrip).exists()).toBe(false)
  })

  it('one «Вернуть» of the screen in the air at a time: each answers with the page whole (adversarial А3)', async () => {
    const pinia = session()
    const store = useAccountsStore(pinia)
    const away = new Date('2026-10-20T10:00:00Z')
    const third = cash({ id: THIRD, name: 'Third', archivedAt: away })
    moneyAccounts.mockResolvedValue(page([cash(), cash({ id: OTHER, archivedAt: away }), third]))
    const view = await open(AccountsView, '/money/accounts', pinia)
    store.removed = { id: 'eeeeeeee-0000-4000-8000-000000000001', name: 'Spare', stamp: Date.now() }
    await view.get('.removed-head').trigger('click')
    await settle()

    let land: (answer: MoneyAccountsResponse) => void = () => undefined
    restoreMoneyAccount.mockImplementation(() => new Promise((resolve) => (land = resolve)))
    await view.get('.removed-restore').trigger('click')
    expect(restoreMoneyAccount).toHaveBeenCalledWith(OTHER)
    expect(view.getComponent(UndoStrip).props('inactive')).toBe(true)
    await view.getComponent(UndoStrip).get('button').trigger('click')
    expect(restoreMoneyAccount).toHaveBeenCalledTimes(1)
    land(page([cash(), cash({ id: OTHER }), third]))
    await settle()
    expect(view.getComponent(UndoStrip).props('inactive')).toBe(false)

    // And the other way: the strip's at work holds the row's.
    await view.getComponent(UndoStrip).get('button').trigger('click')
    await settle()
    expect(view.getComponent(UndoStrip).props('busy')).toBe(true)
    expect(view.get('.removed-restore').attributes('aria-disabled')).toBe('true')
    land(page([cash(), cash({ id: OTHER }), third]))
    await settle()
  })

  it('a date in a row stays whole, and only the date: «started» may still go to the next line (Р1-5, Б1)', async () => {
    moneyAccounts.mockResolvedValue(
      page([cash(), cash({ id: OTHER, archivedAt: new Date('2026-10-21T10:00:00Z') })]),
    )
    const view = await open(AccountsView, '/money/accounts', session())
    expect(view.get('a.list-row .meta').text()).toBe('AMD · started Sep\u00a016')
    await view.get('.removed-head').trigger('click')
    await settle()
    expect(view.get('.removed-open .meta').text()).toMatch(/· put away Oct\u00a021$/)
  })
})

describe('the account’s screen on the kit (MOL-194)', () => {
  const second = cash({ id: '22222222-0000-4000-8000-000000000002', name: 'Card ֏' })
  const removed = (patch: Partial<MoneyAccountView> = {}) =>
    cash({ archivedAt: new Date('2026-09-21T10:00:00Z'), ...patch })
  const offline = () => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const docked = (view: VueWrapper) => view.findAll('.dock button').map((one) => one.text())
  const title = (view: VueWrapper) => view.get('h1.title').text()

  it('«Сверить с фактом» is the strip’s, «Перевести» a ghost under it, the header «Править» alone (В-1 «б»)', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash(), second]))
    accountJournal.mockResolvedValue(journal(cash(), []))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    expect(docked(view)).toEqual([en.accounts.account.reconcile, en.accounts.account.transfer])
    expect(view.findAll('.dock button')[1]?.classes()).toContain('ghost')
    expect(view.get('.trailing').text()).toBe(en.accounts.account.edit)
    expect(view.find('.undo-place').exists()).toBe(false)

    await button(view, en.accounts.account.reconcile)?.trigger('click')
    await settle()
    expect(view.getComponent(ReconcileSheet).props('open')).toBe(true)
  })

  it('must not fire: a removed account offers neither «Сверить» nor «Перевести», «Вернуть» in their place', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([removed(), second]))
    accountJournal.mockResolvedValue(journal(removed(), []))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    expect(docked(view)).toEqual([en.accounts.screen.restore])
    expect(view.get('.trailing').text()).toBe(en.accounts.account.edit)
    // The note of the kit, its date whole (handoff 03 п. 4).
    expect(view.get('.balance ~ .note').text()).toContain('September 21')
  })

  it('«Вернуть» offline is not now and says why; online it works under its word and gives the focus to «Сверить»', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([removed()]))
    accountJournal.mockResolvedValue(journal(removed(), []))
    const spy = offline()
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    const waiting = button(view, en.accounts.screen.restore_wait)
    expect(waiting?.attributes('aria-disabled')).toBe('true')
    await waiting?.trigger('click')
    expect(restoreMoneyAccount).not.toHaveBeenCalled()

    spy.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await settle()
    let land: (value: MoneyAccountsResponse) => void = () => undefined
    restoreMoneyAccount.mockImplementation(() => new Promise((resolve) => (land = resolve)))
    await button(view, en.accounts.screen.restore)?.trigger('click')
    await settle()
    expect(docked(view)).toEqual([en.accounts.screen.restoring])

    land(page([cash()]))
    await settle()
    expect(view.find('.balance ~ .note').exists()).toBe(false)
    expect(docked(view)).toEqual([en.accounts.account.reconcile])
    expect(document.activeElement?.textContent.trim()).toBe(en.accounts.account.reconcile)
  })

  it('a spending removed from a removed account’s journal: two «Вернуть» at once, the strip kept (С-8)', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([removed()]))
    accountJournal.mockResolvedValue(journal(removed(), [spendingRow(TAXI, '-500', CASH)]))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    view.findComponent(OperationSheet).vm.$emit('removed', {
      undo: { id: TAXI, kind: 'restore' },
      title: 'Taxi',
      amount: '֏500',
    })
    await settle()
    expect(view.findComponent(UndoStrip).exists()).toBe(true)
    expect(docked(view)).toEqual([en.accounts.screen.restore])
  })

  it('«Такого счёта нет»: attention, «К счетам» in the strip, no «Повторить», and «Счёт» over it whatever was kept (8h)', async () => {
    useAccountsStore(session()).accept(page([cash()]))
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([]))
    accountJournal.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'gone', true))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    expect(view.getComponent(ScreenState).props('kind')).toBe('attention')
    expect(docked(view)).toEqual([en.accounts.account.to_list])
    expect(button(view, en.state.retry)).toBeUndefined()
    expect(title(view)).toBe(en.accounts.account.title)
    expect(view.find('.trailing').text()).toBe('')
  })

  it('the title is the name the phone keeps while the journal is on its way or failed, else «Счёт» (Е-6)', async () => {
    moneyAccounts.mockImplementation(() => new Promise(() => undefined))
    accountJournal.mockImplementation(() => new Promise(() => undefined))
    const cold = await open(AccountView, `/money/accounts/${CASH}`, session())
    expect(title(cold)).toBe(en.accounts.account.title)
    // No strip over the skeleton: nothing is known to act on yet.
    expect(cold.find('.dock').exists()).toBe(false)

    useAccountsStore(session()).accept(page([cash({ inSpend: amd('100') })]))
    const kept = await open(AccountView, `/money/accounts/${CASH}`, session())
    expect(title(kept)).toBe('Cash ֏')
    // The skeleton in the answer's shape, «≈» where the kept account has it.
    const parts = kept.findAllComponents(SkeletonPart).map((one) => one.props('kind'))
    expect(parts).toEqual(['figure', 'caption', 'rows'])
    expect(kept.findAllComponents(SkeletonPart)[0]?.props('approx')).toBe(true)

    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    accountJournal.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await open(AccountView, `/money/accounts/${CASH}`, session())
    expect(failed.getComponent(ScreenState).props('kind')).toBe('error')
    expect(title(failed)).toBe('Cash ֏')
  })

  it('a journal kept, the server silent: one strip with «Повторить», a failed retry said again; offline the cloud', async () => {
    useAccountsStore(session()).accept(page([cash()], new Date('2026-09-26T10:05:00Z')))
    rememberJournal(OWNER, journal(cash(), [spendingRow(TAXI, '-500', CASH)]))
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    accountJournal.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    const strip = view.getComponent(StatusStrip)
    expect(strip.props('kind')).toBe('unanswered')
    // The balance is the phone's too: the hour of the page it came from (review №1).
    expect(strip.props('text')).toMatch(/^The server did not answer · balances as of /)
    expect(view.findComponent(ScreenState).exists()).toBe(false)
    const before = strip.props('attempt') as number
    await button(view, en.state.retry)?.trigger('click')
    await settle()
    expect(view.getComponent(StatusStrip).props('attempt')).toBe(before + 1)
    // The strip of the screen keeps its action under the strip of the connection.
    expect(docked(view)).toEqual([en.accounts.account.reconcile])

    offline()
    const away = await open(AccountView, `/money/accounts/${CASH}`, session())
    const cloud = away.getComponent(StatusStrip)
    expect(cloud.props('kind')).toBe('offline')
    expect(cloud.props('text')).toMatch(/^Offline · balances as of /)
  })

  // By the last read, as «Счета» (MOL-183, Б1): an answer earlier in this session hid a read that
  // failed after it, and the transfer the balance has was in no journal, with nothing to say so (А1).
  it('a journal answered, then a re-read failed: «Сервер не ответил» with «Повторить», no hour over a fresh page', async () => {
    const pinia = session()
    const store = useAccountsStore(pinia)
    moneyAccounts.mockResolvedValue(page([cash(), second]))
    accountJournal.mockResolvedValue(journal(cash(), [spendingRow(TAXI, '-500', CASH)]))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    expect(view.findComponent(StatusStrip).exists()).toBe(false)

    accountJournal.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    store.accept(page([cash({ balance: amd('90000') }), second]))
    store.transfers += 1
    await settle()
    const strip = view.getComponent(StatusStrip)
    expect(strip.props('kind')).toBe('unanswered')
    expect(strip.props('text')).toBe(en.accounts.account.unanswered)

    accountJournal.mockResolvedValue(journal(cash({ balance: amd('90000') }), []))
    await button(view, en.state.retry)?.trigger('click')
    await settle()
    expect(view.findComponent(StatusStrip).exists()).toBe(false)
  })

  it('a journal answered, then the connection lost: the cloud, as «Счета» a step back say it (А2)', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([cash(), second]))
    accountJournal.mockResolvedValue(journal(cash(), []))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    expect(view.findComponent(StatusStrip).exists()).toBe(false)
    offline()
    window.dispatchEvent(new Event('offline'))
    await settle()
    expect(view.getComponent(StatusStrip).props('kind')).toBe('offline')
  })

  // The strip's actions swapped under the focus by an answer, not the person's tap (Б2, Б3).
  it.each([
    [
      'put away on another phone: to «Вернуть»',
      () => {
        moneyAccounts.mockResolvedValue(page([removed({ revision: 2 })]))
        accountJournal.mockResolvedValue(journal(removed({ revision: 2 }), []))
      },
      en.accounts.screen.restore,
    ],
    [
      'deleted on another phone: to «К счетам»',
      () => {
        moneyAccounts.mockResolvedValue(page([]))
        accountJournal.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'gone', true))
      },
      en.accounts.account.to_list,
    ],
  ])('the account %s — the focus on «Сверить» goes with the strip', async (_, gone, next) => {
    const pinia = session()
    const store = useAccountsStore(pinia)
    moneyAccounts.mockResolvedValue(page([cash()]))
    accountJournal.mockResolvedValue(journal(cash(), []))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    ;(button(view, en.accounts.account.reconcile)?.element as HTMLElement).focus()
    gone()
    await store.refresh()
    store.transfers += 1
    await settle()
    expect(docked(view)).toEqual([next])
    expect(document.activeElement?.textContent.trim()).toBe(next)
  })

  // «Обновить» of a version waiting stands over «Сверить» in the strip: the focus brought back is the
  // screen's, never a reload the next Enter would let in (review №3, adversarial Г2).
  it('«Вернуть» answered with a version waiting: the focus to «Сверить с фактом», not to «Обновить»', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([removed()]))
    accountJournal.mockResolvedValue(journal(removed(), []))
    restoreMoneyAccount.mockResolvedValue(page([cash({ revision: 2 })]))
    const update: PwaUpdate = {
      phase: shallowRef<UpdatePhase>('ready'),
      apply: vi.fn(),
      serverVersion: vi.fn(),
      build: () => null,
    }
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia, {}, update)
    const back = button(view, en.accounts.screen.restore)
    ;(back?.element as HTMLElement).focus()
    await back?.trigger('click')
    await settle()
    expect(docked(view)).toEqual([en.update.apply, en.accounts.account.reconcile])
    expect(document.activeElement?.textContent.trim()).toBe(en.accounts.account.reconcile)
  })

  it('must not fire: «Вернуть» answered leaves a focus the person took elsewhere meanwhile (В)', async () => {
    const pinia = session()
    moneyAccounts.mockResolvedValue(page([removed()]))
    accountJournal.mockResolvedValue(journal(removed(), [spendingRow(TAXI, '-500', CASH)]))
    let land: (value: MoneyAccountsResponse) => void = () => undefined
    restoreMoneyAccount.mockImplementation(() => new Promise((resolve) => (land = resolve)))
    const view = await open(AccountView, `/money/accounts/${CASH}`, pinia)
    await button(view, en.accounts.screen.restore)?.trigger('click')
    await settle()
    const row = view.getComponent(OperationRow).get('button').element as HTMLElement
    row.focus()
    land(page([cash({ revision: 2 })]))
    await settle()
    expect(docked(view)).toEqual([en.accounts.account.reconcile])
    expect(document.activeElement).toBe(row)
  })
})

describe('the check is blind behind its sheet (MOL-195, Ф-33)', () => {
  /** The card of the balance, whole: its words, its attributes and what it would say aloud. */
  const card = (view: VueWrapper) => plain(view.get('.balance').html())
  const figure = (view: VueWrapper) => view.get('.balance .figure')

  async function screen(balance = amd('190132'), inSpend: MoneyAccountView['inSpend'] = null) {
    const pinia = session()
    const account = cash({ balance, inSpend, lastCheckedOn: '2026-09-20' })
    moneyAccounts.mockResolvedValue(page([account]))
    accountJournal.mockResolvedValue(journal(account, []))
    return open(AccountView, `/money/accounts/${CASH}`, pinia)
  }
  async function startCheck(view: VueWrapper): Promise<void> {
    await button(view, en.accounts.account.reconcile)?.trigger('click')
    await settle()
  }

  it('step one: «•••» and its words for a reader — no figure, no «≈», the start and «сверено» stay', async () => {
    const view = await screen(amd('190132'), parseMoney('5921.05', 'RUB'))
    expect(card(view)).toContain('190,132')
    expect(view.find('.balance .approx').exists()).toBe(true)
    await startCheck(view)
    expect(card(view)).not.toContain('190,132')
    expect(card(view)).not.toContain('5,921')
    expect(view.find('.balance .approx').exists()).toBe(false)
    expect(figure(view).text()).toContain('•••')
    expect(figure(view).text()).toContain(en.accounts.account.balance_hidden)
    expect(figure(view).get('[aria-hidden="true"]').text()).toBe('•••')
    expect(plain(view.get('.balance .footnote').text())).toMatch(/^started .* · checked Sep 20$/)
    // Nothing of it on the page, the open sheet and the live regions included; a shut sheet — the
    // picker of «Перевести», mounted with the screen — is neither drawn nor read.
    expect(view.findAll('dialog[open]')).toHaveLength(1)
    const seen = document.body.cloneNode(true) as HTMLElement
    for (const shut of seen.querySelectorAll('dialog:not([open])')) shut.remove()
    expect(seen.textContent).not.toMatch(/190,132/)
  })

  it('the answer gives it back, «Ввести другую сумму» hides it again, closing shows it', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const view = await screen()
    await startCheck(view)
    const sheet = view.getComponent(ReconcileSheet)
    await sheet.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await settle()
    expect(figure(view).text()).toContain('190,132')

    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await settle()
    expect(figure(view).text()).not.toContain('190,132')
    expect(figure(view).text()).toContain(en.accounts.account.balance_hidden)

    sheet.vm.$emit('update:open', false)
    await settle()
    expect(figure(view).text()).toContain('190,132')
  })

  it('every opening starts blind, the last answer of the sheet notwithstanding', async () => {
    checkAccount.mockResolvedValue(answer('190132', '190132'))
    const view = await screen()
    await startCheck(view)
    await view.getComponent(ReconcileSheet).get('input').setValue('190132')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await settle()
    view.getComponent(ReconcileSheet).vm.$emit('update:open', false)
    await settle()

    await button(view, en.accounts.account.reconcile)?.trigger('click')
    // The sheet is put back on the fact as it opens, and tells the screen before anything is drawn.
    await nextTick()
    expect(card(view)).not.toContain('190,132')
  })

  it('review Р2-3: an opening is blind with no answer to clear — a sheet mounted anew says «fact» too', async () => {
    const view = await screen()
    // The screen was last told «result», and the sheet holds no answer — as one mounted anew would.
    view.getComponent(ReconcileSheet).vm.$emit('step', 'result')
    await settle()
    expect(card(view)).toContain('190,132')

    await startCheck(view)
    expect(card(view)).not.toContain('190,132')
    expect(figure(view).text()).toContain(en.accounts.account.balance_hidden)
  })

  it('adversarial А4: «≈ … по моему курсу» grows and shrinks, never in one frame (MOL-151)', async () => {
    const view = await screen(amd('190132'), parseMoney('5921.05', 'RUB'))
    const reveal = view.get('.balance').findComponent(AppReveal)
    expect(reveal.exists()).toBe(true)
    expect(reveal.find('.approx').exists()).toBe(true)
    await startCheck(view)
    expect(view.find('.balance .approx').exists()).toBe(false)
  })

  it('a balance below zero is not told by its colour while hidden', async () => {
    const view = await screen(amd('-1200'))
    expect(figure(view).classes()).toContain('negative')
    await startCheck(view)
    expect(figure(view).classes()).not.toContain('negative')
    expect(card(view)).not.toContain('1,200')
  })

  it('must not fire: no sheet, no dots — and the figure is no live region (С-12)', async () => {
    const view = await screen()
    expect(figure(view).text()).not.toContain('•••')
    expect(figure(view).attributes('aria-live')).toBeUndefined()
    expect(view.text()).not.toContain(en.accounts.account.balance_hidden)
  })
})

/**
 * MOL-196, adversarial А1: a page kept from an earlier launch is no answer, so the sheet speaks of the
 * account the screen under it prints — the journal's — never of yesterday's page over it.
 */
describe('the account’s sheet over a page kept from before (MOL-196, adversarial А1)', () => {
  /** «now …», as a reader meets it: by the description of the amount's field. */
  function nowOf(view: VueWrapper): string | null {
    const input = view
      .findComponent(AccountSheet)
      .findAll('input')
      .find((one) => one.attributes('inputmode') === 'decimal')
    if (!input) throw new Error('no amount field')
    const hint = (input.attributes('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((one) => one?.classList.contains('hint'))
    return hint ? plain(hint.textContent.trim()) : null
  }
  const taxi = () => spendingRow(TAXI, '-2000', CASH)

  it('the page’s read failed: «now» is the card’s 98,000, not yesterday’s 100,000', async () => {
    useAccountsStore(session()).accept(page([cash()], new Date('2026-09-26T21:00:00Z')))
    const today = cash({ balance: amd('98000'), revision: 2 })
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'down', true))
    accountJournal.mockResolvedValue(journal(today, [taxi()]))

    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    expect(plain(view.get('.balance .figure').text())).toContain('98,000')
    await button(view, en.accounts.account.edit)?.trigger('click')
    await settle()
    expect(nowOf(view)).toBe('now ֏98,000')
  })

  it('the page still on its way: «now» is the journal’s, and stays when the page lands (А1в)', async () => {
    useAccountsStore(session()).accept(page([cash()], new Date('2026-09-26T21:00:00Z')))
    const today = cash({ balance: amd('98000'), revision: 2 })
    let land: (value: MoneyAccountsResponse) => void = () => undefined
    moneyAccounts.mockImplementation(
      () =>
        new Promise((resolve) => {
          land = resolve
        }),
    )
    accountJournal.mockResolvedValue(journal(today, [taxi()]))

    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    await button(view, en.accounts.account.edit)?.trigger('click')
    await settle()
    expect(nowOf(view)).toBe('now ֏98,000')
    land(page([today]))
    await settle()
    expect(nowOf(view)).toBe('now ֏98,000')
  })

  it('one version in the whole sheet: the lock and the meta agree with «Put away» (А1б)', async () => {
    useAccountsStore(session()).accept(
      page([cash({ hasOperations: false })], new Date('2026-09-26T21:00:00Z')),
    )
    const today = cash({ balance: amd('98000'), revision: 2, hasOperations: true })
    moneyAccounts.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'down', true))
    accountJournal.mockResolvedValue(journal(today, [taxi()]))

    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    await button(view, en.accounts.account.edit)?.trigger('click')
    await settle()
    const sheet = view.findComponent(AccountSheet)
    expect(sheet.text()).not.toContain(en.accounts.no_operations)
    expect(sheet.find('select').exists()).toBe(false)
    expect(button(view, en.accounts.sheet.archive)).toBeDefined()
  })

  it('the page answered in this session: the sheet reads it, as the card does (must not fire)', async () => {
    useAccountsStore(session()).accept(page([cash()], new Date('2026-09-26T21:00:00Z')))
    const today = cash({ balance: amd('98000'), revision: 2 })
    moneyAccounts.mockResolvedValue(page([today]))
    accountJournal.mockResolvedValue(journal(today, [taxi()]))

    const view = await open(AccountView, `/money/accounts/${CASH}`, session())
    await button(view, en.accounts.account.edit)?.trigger('click')
    await settle()
    expect(plain(view.get('.balance .figure').text())).toContain('98,000')
    expect(nowOf(view)).toBe('now ֏98,000')
  })
})
