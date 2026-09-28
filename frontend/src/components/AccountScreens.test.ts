import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney, parseQuantity } from '@molvia/model'
import type {
  AccountCheckBody,
  AccountCheckResponse,
  AccountOperationView,
  Currency,
  MoneyAccountBody,
  MoneyAccountView,
  MoneyAccountsResponse,
  SpendingCategoryView,
} from '@molvia/model'
import AccountSheet from './AccountSheet.vue'
import AccountsCard from './AccountsCard.vue'
import OperationSheet from './OperationSheet.vue'
import ReconcileSheet from './ReconcileSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useAccountsStore } from '@/stores/accounts'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { useTripQueueStore } from '@/stores/tripQueue'

const checkAccount = vi.fn<(id: string, body: AccountCheckBody) => Promise<AccountCheckResponse>>()
const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>()
const addMoneyAccount =
  vi.fn<
    (body: MoneyAccountBody) => Promise<{ accounts: MoneyAccountsResponse; created: boolean }>
  >()
const removeMoneyAccount = vi.fn<(id: string) => Promise<MoneyAccountsResponse>>()
const spendingCategories = vi.fn<() => Promise<{ categories: SpendingCategoryView[] }>>()
vi.mock('@/api', () => ({
  api: {
    checkAccount: (id: string, body: AccountCheckBody) => checkAccount(id, body),
    moneyAccounts: () => moneyAccounts(),
    addMoneyAccount: (body: MoneyAccountBody) => addMoneyAccount(body),
    removeMoneyAccount: (id: string) => removeMoneyAccount(id),
    spendingCategories: () => spendingCategories(),
  },
}))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const OTHER = 'ffffffff-0000-4000-8000-00000000000d'
const TAXI = 'eeeeeeee-0000-4000-8000-000000000001'
const TRIP = 'eeeeeeee-0000-4000-8000-000000000002'
const CARD = 'eeeeeeee-0000-4000-8000-000000000003'
const SAUCE = 'eeeeeeee-0000-4000-8000-000000000004'
const ITEM = 'eeeeeeee-0000-4000-8000-000000000005'
/** Drams, below zero too — an account in debt, a spending out. */
function amd(text: string) {
  const money = parseMoney(text.replace('-', ''), 'AMD')
  return text.startsWith('-') ? { ...money, minor: -money.minor } : money
}
let next = 0

function account(
  name: string,
  currency: Currency = 'AMD',
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
    balance: parseMoney('190132', currency),
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

function page(accounts: MoneyAccountView[], unassigned = 0): MoneyAccountsResponse {
  return {
    spendCurrency: 'AMD',
    accounts,
    totals: { total: amd('190132'), spendable: amd('-5000'), savings: amd('0'), uncounted: 0 },
    unassigned,
    countedAt: new Date(),
  }
}

function withAccounts(accounts: MoneyAccountView[], unassigned = 0): Pinia {
  const pinia = createPinia()
  const actor = useActorStore(pinia)
  actor.id = OWNER
  actor.state = 'idle'
  useAccountsStore(pinia).accept(page(accounts, unassigned))
  return pinia
}

const categories: SpendingCategoryView[] = [
  { id: OTHER, preset: 'other', name: null, colour: null, archived: false },
]

let clock = 0

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  for (const mock of [checkAccount, moneyAccounts, addMoneyAccount, removeMoneyAccount])
    mock.mockReset()
  spendingCategories.mockReset().mockResolvedValue({ categories: [] })
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
  await router.push('/money/accounts')
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

const button = (view: VueWrapper, text: string | RegExp) =>
  view
    .findAll('button')
    .find((one) => (typeof text === 'string' ? one.text() === text : text.test(one.text())))

function taxi(): AccountOperationView {
  return {
    kind: 'spending',
    id: TAXI,
    side: null,
    day: '2026-09-22',
    at: new Date('2026-09-22T09:00:00Z'),
    accountId: null,
    amounts: [amd('-1200')],
    moved: null,
    approximate: false,
    debited: null,
    inBalance: false,
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

function answer(fact: string, counted: string, reasons: AccountCheckResponse['reasons'] = []) {
  const factMoney = amd(fact)
  const countedMoney = amd(counted)
  return {
    id: '11111111-0000-4000-8000-000000000001',
    checkedOn: '2026-09-26',
    fact: factMoney,
    counted: countedMoney,
    difference: { ...factMoney, minor: factMoney.minor - countedMoney.minor },
    approximate: false,
    since: '2026-09-16',
    reasons,
  }
}

describe('ReconcileSheet (handoff 05)', () => {
  const cash = account('Cash ֏')

  async function reconcile(pinia: Pinia): Promise<VueWrapper> {
    moneyAccounts.mockResolvedValue(page([cash]))
    return mounted(
      ReconcileSheet,
      {
        open: true,
        account: cash,
        categories,
        nameOf: () => 'Other',
        accountName: () => null,
      },
      pinia,
    )
  }

  it('step one says nothing of the app’s count — neither in text nor aloud', async () => {
    const view = await reconcile(withAccounts([cash]))
    const dialog = view.get('dialog')
    expect(dialog.text()).not.toMatch(/190\s132/)
    expect(dialog.html()).not.toMatch(/190\s132/)
  })

  it('a difference is neutral, with its reason; the same fact again is the same check', async () => {
    checkAccount.mockResolvedValue(
      answer('185000', '190132', [{ kind: 'unassigned', operation: taxi() }]),
    )
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    const plate = view.get('.difference')
    expect(plate.text()).toContain('−֏5,132')
    expect(plate.classes()).not.toContain('negative')
    expect(view.text()).toContain('Spending ֏1,200 with no account')
    const [id] = checkAccount.mock.calls[0] ?? []
    expect(id).toBe(cash.id)

    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    const [first, second] = checkAccount.mock.calls.map(([, body]) => body.id)
    expect(second).toBe(first)

    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('184000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(checkAccount.mock.calls[2]?.[1].id).not.toBe(first)
  })

  it('review 6: the same fact after an answer that never came goes under the same name', async () => {
    checkAccount
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'offline', false))
      .mockResolvedValue(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    const [first, second] = checkAccount.mock.calls.map(([, body]) => body.id)
    expect(second).toBe(first)
  })

  it('review 3: a recount that lands after «Ввести другую сумму» does not take the sheet back', async () => {
    checkAccount.mockResolvedValueOnce(
      answer('185000', '190132', [{ kind: 'unassigned', operation: taxi() }]),
    )
    const pinia = withAccounts([cash])
    const view = await reconcile(pinia)
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    // The reason is put right in its sheet; the check is asked again once the queue lands…
    view.findComponent(OperationSheet).vm.$emit('saved')
    let late: (value: AccountCheckResponse) => void = () => undefined
    checkAccount.mockImplementationOnce(() => new Promise((resolve) => (late = resolve)))
    useSpendingQueueStore(pinia).landed++
    await flushPromises()
    // …and while that answer is out, the person goes back to type another fact.
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    late(answer('185000', '190132'))
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.question)
    expect(view.text()).not.toMatch(/190,132/)
  })

  it('«Записать разницу» writes one «Прочее» for the server’s sum, however many taps', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const pinia = withAccounts([cash])
    const view = await reconcile(pinia)
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.no_causes_title)
    const write = button(view, /Record the difference/)
    await write?.trigger('click')
    await write?.trigger('click')
    const records = useSpendingQueueStore(pinia).pending.filter((one) => one.kind === 'record')
    expect(records).toHaveLength(1)
    expect(records[0]?.kind === 'record' && records[0].body).toMatchObject({
      amount: amd('5132'),
      categoryId: OTHER,
      note: en.accounts.reconcile.note,
      accountId: cash.id,
      spentOn: '2026-09-26',
    })
  })

  it('an even count says so, and offers nothing to write', async () => {
    checkAccount.mockResolvedValue(answer('190132', '190132'))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('190132')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.match_title)
    expect(button(view, /Record the difference/)).toBeUndefined()
  })

  it('review 33: a count answered while a trip’s removal waits stays muted until it lands', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const pinia = withAccounts([cash])
    const trips = useTripQueueStore(pinia)
    trips.pending = [{ kind: 'delete', tripId: TRIP }]
    const view = await reconcile(pinia)
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.get('.difference').classes()).toContain('stale')
    expect(button(view, /Record the difference/)?.attributes('disabled')).toBeDefined()

    checkAccount.mockResolvedValue(answer('185000', '185000'))
    trips.pending = []
    trips.wrote++
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(2)
    expect(view.text()).toContain(en.accounts.reconcile.match_title)
  })

  it('round 3, Н4: a trip’s write held on a question of «Поход» is named, not waited on', async () => {
    checkAccount.mockResolvedValue(answer('9000', '10000'))
    const pinia = withAccounts([cash])
    const trips = useTripQueueStore(pinia)
    trips.elsewhere = { tripId: TRIP, place: 'Ереван Сити', mine: 'Рынок' }
    // Put on the card — maybe taken off this cash, which the queue cannot say (review 37, Н6): the
    // check counts without it, is not muted, says what waits, and writes nothing over it.
    trips.pending = [{ kind: 'payment', tripId: TRIP, body: { accountId: CARD, debited: null } }]
    const view = await reconcile(pinia)
    await view.get('input').setValue('9000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.get('.difference').classes()).not.toContain('stale')
    expect(button(view, /Record the difference/)?.attributes('disabled')).toBeDefined()
    expect(view.text()).toContain(en.accounts.reconcile.trips_held)

    // Control: a write the queue sends by itself is waited on, and the wait is said.
    trips.elsewhere = null
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('9000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.get('.difference').classes()).toContain('stale')
    expect(view.text()).toContain(en.accounts.reconcile.recounting)
    expect(view.text()).not.toContain(en.accounts.reconcile.trips_held)
  })

  it('review 36, round 4 Н5: this account’s trip held on «Поход» — nothing written until it lands', async () => {
    checkAccount.mockResolvedValue(answer('6200', '10000'))
    const pinia = withAccounts([cash])
    const trips = useTripQueueStore(pinia)
    trips.elsewhere = { tripId: TRIP, place: 'Ереван Сити', mine: 'Рынок' }
    trips.pending = [{ kind: 'payment', tripId: TRIP, body: { accountId: cash.id, debited: null } }]
    const view = await reconcile(pinia)
    await view.get('input').setValue('6200')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    // Counted without it — honest — but its money cannot become «Прочее».
    expect(view.get('.difference').classes()).not.toContain('stale')
    expect(button(view, /Record the difference/)?.attributes('disabled')).toBeDefined()
    expect(view.text()).toContain(en.accounts.reconcile.trips_held)

    // The person answers on «Поход», the account lands: the same check once more.
    checkAccount.mockResolvedValue(answer('6200', '6200'))
    trips.elsewhere = null
    await flushPromises()
    trips.pending = []
    trips.wrote++
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(2)
    expect(view.text()).toContain(en.accounts.reconcile.match_title)
  })

  it('review 37, round 5 Н7: the question settled by itself — muted while the write is on its way', async () => {
    checkAccount.mockResolvedValue(answer('6200', '10000'))
    const pinia = withAccounts([cash])
    const trips = useTripQueueStore(pinia)
    trips.elsewhere = { tripId: TRIP, place: 'Ереван Сити', mine: 'Рынок' }
    trips.pending = [{ kind: 'payment', tripId: TRIP, body: { accountId: cash.id, debited: null } }]
    const view = await reconcile(pinia)
    await view.get('input').setValue('6200')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    // The open trip was finished on another phone: the payment leaves, its answer still out.
    trips.elsewhere = null
    await flushPromises()
    expect(view.get('.difference').classes()).toContain('stale')
    expect(button(view, /Record the difference/)?.attributes('disabled')).toBeDefined()
    expect(checkAccount).toHaveBeenCalledTimes(1)
  })

  it('round 6, Н8: a purchase of a trip in the queue is waited for — or, held, shuts the write', async () => {
    checkAccount.mockResolvedValue(answer('8800', '10000'))
    const pinia = withAccounts([cash])
    const trips = useTripQueueStore(pinia)
    // The sauce found at home, added to last week's trip on the cash: its answer still out.
    trips.pending = [
      {
        kind: 'add',
        tripId: TRIP,
        entry: null,
        body: { id: SAUCE, itemId: ITEM, quantity: parseQuantity('1', 'l'), amount: amd('1200') },
      },
    ]
    const view = await reconcile(pinia)
    await view.get('input').setValue('8800')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.get('.difference').classes()).toContain('stale')
    expect(button(view, /Record the difference/)?.attributes('disabled')).toBeDefined()

    // Behind a question of «Поход»: not waited on, named, and nothing written over it.
    trips.elsewhere = { tripId: TRIP, place: 'Ереван Сити', mine: 'Рынок' }
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('8800')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.get('.difference').classes()).not.toContain('stale')
    expect(button(view, /Record the difference/)?.attributes('disabled')).toBeDefined()
    expect(view.text()).toContain(en.accounts.reconcile.trips_held)
  })

  it('review, sixth pass: a held write gone without being sent — the check is asked again at once', async () => {
    checkAccount.mockResolvedValue(answer('6200', '10000'))
    const pinia = withAccounts([cash])
    const trips = useTripQueueStore(pinia)
    trips.elsewhere = { tripId: TRIP, place: 'Ереван Сити', mine: 'Рынок' }
    trips.pending = [{ kind: 'payment', tripId: TRIP, body: { accountId: cash.id, debited: null } }]
    const view = await reconcile(pinia)
    await view.get('input').setValue('6200')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    // Another window took the refused trip away: nothing will land.
    checkAccount.mockResolvedValue(answer('6200', '6200'))
    trips.pending = []
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(2)
    expect(view.text()).toContain(en.accounts.reconcile.match_title)
  })

  it('review 35: no «Прочее» known — asked for, named when it fails, and «Повторить» writes', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    spendingCategories.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'down', true))
    const pinia = withAccounts([cash])
    moneyAccounts.mockResolvedValue(page([cash]))
    const view = await mounted(
      ReconcileSheet,
      { open: true, account: cash, categories: [], nameOf: () => 'Other', accountName: () => null },
      pinia,
    )
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await button(view, /Record the difference/)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.no_other)
    const records = () =>
      useSpendingQueueStore(pinia).pending.filter((one) => one.kind === 'record')
    expect(records()).toHaveLength(0)

    spendingCategories.mockResolvedValueOnce({ categories })
    await button(view, en.state.retry)?.trigger('click')
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(1)
    expect(records()).toHaveLength(1)
    expect(records()[0]?.kind === 'record' && records()[0]?.body.categoryId).toBe(OTHER)
  })

  it('review 34: offline is said once, and goes when the connection comes back', async () => {
    checkAccount.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'offline', false))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await view.setProps({ online: false })
    expect(view.findAll('.strip')).toHaveLength(1)
    expect(view.find('[role="alert"]').exists()).toBe(false)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    await view.setProps({ online: true })
    expect(view.findAll('.strip')).toHaveLength(0)
  })

  it('offline the check waits for the connection, and is not red', async () => {
    const view = await mounted(
      ReconcileSheet,
      {
        open: true,
        account: cash,
        online: false,
        categories,
        nameOf: () => 'Other',
        accountName: () => null,
      },
      withAccounts([cash]),
    )
    const wait = button(view, en.accounts.reconcile.wait_online)
    expect(wait?.attributes('disabled')).toBeDefined()
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('AccountSheet (handoff 03)', () => {
  it('refuses an empty name and a name already there, under the field, before sending', async () => {
    const cash = account('Cash ֏')
    const view = await mounted(
      AccountSheet,
      { open: true, spendCurrency: 'AMD' },
      withAccounts([cash]),
    )
    await button(view, en.accounts.sheet.save)?.trigger('click')
    expect(view.text()).toContain(en.accounts.sheet.no_name)
    expect(view.text()).toContain(en.accounts.sheet.bad_start)
    const name = view.findAll('input').at(0)
    await name?.setValue('  cash ֏ ')
    await button(view, en.accounts.sheet.save)?.trigger('click')
    expect(view.text()).toContain('already')
    expect(addMoneyAccount).not.toHaveBeenCalled()
  })

  it('takes a card in debt, and a repeat of the same sheet names the same account', async () => {
    addMoneyAccount.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'offline', false))
    addMoneyAccount.mockResolvedValue({ accounts: page([]), created: true })
    const view = await mounted(AccountSheet, { open: true, spendCurrency: 'RUB' }, withAccounts([]))
    const inputs = view.findAll('input')
    await inputs.at(0)?.setValue('Credit card')
    await view
      .findAll('.field')
      .find((one) => one.text().includes(en.accounts.balance))
      ?.get('input')
      .setValue('−12400')
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.sheet.failed)
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await flushPromises()
    const [first, second] = addMoneyAccount.mock.calls.map(([body]) => body)
    expect(first?.start).toEqual({ minor: -1_240_000n, currency: 'RUB' })
    expect(second?.id).toBe(first?.id)
  })

  it('with operations: the currency is locked and the account is taken out of the choice', async () => {
    const used = account('Card $', 'USD', { hasOperations: true })
    const view = await mounted(
      AccountSheet,
      { open: true, account: used, spendCurrency: 'AMD' },
      withAccounts([used]),
    )
    expect(view.find('select').exists()).toBe(false)
    expect(view.text()).toContain(en.error.money_account_currency_locked)
    expect(button(view, en.accounts.sheet.archive)).toBeDefined()
    expect(button(view, en.accounts.sheet.delete)).toBeUndefined()
  })

  it('without operations: «Удалить», and the page decides it was a deletion', async () => {
    const spare = account('Spare')
    removeMoneyAccount.mockResolvedValue(page([]))
    const view = await mounted(
      AccountSheet,
      { open: true, account: spare, spendCurrency: 'AMD' },
      withAccounts([spare]),
    )
    await button(view, en.accounts.sheet.delete)?.trigger('click')
    await flushPromises()
    // Told once the sheet is away, not while its step back is on its way.
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
    expect(view.emitted('done')).toBeUndefined()
    await view.setProps({ open: false })
    await vi.waitFor(() => {
      expect(view.emitted('done')?.[0]).toEqual([{ kind: 'deleted', id: spare.id, name: 'Spare' }])
    })
  })

  it('review 5: a save goes over the version the form was filled from, not a newer one read since', async () => {
    const amendMoneyAccount = vi.fn()
    const card = account('Card ₽', 'RUB')
    const pinia = withAccounts([card])
    const view = await mounted(
      AccountSheet,
      { open: true, account: card, spendCurrency: 'AMD' },
      pinia,
    )
    // Another device renamed it; a landing read the page again while this form was open.
    useAccountsStore(pinia).accept(page([{ ...card, name: 'Card of mine', revision: 2 }]))
    await flushPromises()
    const { api } = await import('@/api')
    ;(api as unknown as Record<string, unknown>).amendMoneyAccount =
      amendMoneyAccount.mockRejectedValue(new ApiError(ERROR.CONFLICT, 'revision'))
    moneyAccounts.mockResolvedValue(page([{ ...card, name: 'Card of mine', revision: 2 }]))
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await flushPromises()
    expect(amendMoneyAccount.mock.calls[0]?.[1]).toMatchObject({ revision: 1 })
    expect(view.text()).toContain(en.accounts.sheet.conflict)
  })

  it('offline it keeps what was typed and waits for the connection', async () => {
    const view = await mounted(
      AccountSheet,
      { open: true, spendCurrency: 'AMD', online: false },
      withAccounts([]),
    )
    expect(view.text()).toContain(en.accounts.sheet.offline)
    expect(button(view, en.accounts.sheet.wait_online)?.attributes('disabled')).toBeDefined()
  })
})

describe('AccountsCard (handoff 01)', () => {
  it('five accounts all, six — four and «Ещё 2»; savings last; a minus drawn as «плохо»', async () => {
    const five = [
      account('Savings', 'USD', { savings: true }),
      account('A'),
      account('B', 'AMD', { balance: amd('-12400') }),
      account('C'),
      account('D'),
    ]
    moneyAccounts.mockResolvedValue(page(five))
    const view = await mounted(AccountsCard, { spendCurrency: 'AMD' }, withAccounts(five))
    const rows = view.findAll('.line').map((one) => one.text())
    expect(rows).toHaveLength(5)
    expect(rows.at(-1)).toContain('Savings')
    expect(view.findAll('.balance.negative').map((one) => one.text())).toEqual(['−֏12,400'])

    const six = [...five, account('E')]
    moneyAccounts.mockResolvedValue(page(six, 3))
    const more = await mounted(AccountsCard, { spendCurrency: 'AMD' }, withAccounts(six, 3))
    expect(more.findAll('.line')).toHaveLength(4)
    expect(more.text()).toContain('2 more accounts')
    expect(more.text()).toContain('3 entries')
  })

  it('no account — an offer, not a state; the month under it is not held', async () => {
    moneyAccounts.mockResolvedValue(page([]))
    const view = await mounted(AccountsCard, { spendCurrency: 'AMD' }, withAccounts([]))
    expect(view.text()).toContain(en.accounts.offer.title)
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })
})
