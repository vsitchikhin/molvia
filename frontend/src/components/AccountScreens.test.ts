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
import OperationSheet from './OperationSheet.vue'
import ReconcileSheet from './ReconcileSheet.vue'
import StatusStrip from './StatusStrip.vue'
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
    incomeTotals: null,
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
  { id: OTHER, preset: 'other', name: null, colour: null, icon: null, archived: false },
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

/** Not now in the kit's one look (Ф-6): saying why, `aria-disabled` and in the focus order. */
function expectNotNow(view: VueWrapper, word: string): void {
  const found = button(view, word)
  expect(found, word).toBeDefined()
  expect(found?.attributes('aria-disabled')).toBe('true')
  expect(found?.attributes('disabled')).toBeUndefined()
}

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
    transferId: null,
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

  // The kit's field (MOL-235): the error is read with the field the focus goes back to, the hint beside it.
  it('no fact: nothing is sent, the error is under the field and the focus in it', async () => {
    const view = await reconcile(withAccounts([cash]))
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    const input = view.get('input[data-field="fact"]')
    expect(checkAccount).not.toHaveBeenCalled()
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(input.element)
    const described = (input.attributes('aria-describedby') ?? '').split(' ')
    const words = described.map((id) => document.getElementById(id)?.textContent.trim())
    expect(words).toContain(en.accounts.reconcile.no_fact)
    expect(words).toContain(en.accounts.reconcile.hint)
    expect(view.get('label').text()).toBe(en.accounts.reconcile.question)
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
    expect(view.text()).toContain(en.accounts.reconcile.recounting)
    expectNotNow(view, en.accounts.reconcile.write_after_recount)

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
    expect(view.text()).not.toContain(en.accounts.reconcile.recounting)
    expectNotNow(view, en.accounts.reconcile.write_after_answer)
    expect(view.text()).toContain(en.accounts.reconcile.trips_held)

    // Control: a write the queue sends by itself is waited on, and the wait is said.
    trips.elsewhere = null
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('9000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
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
    expect(view.text()).not.toContain(en.accounts.reconcile.recounting)
    expectNotNow(view, en.accounts.reconcile.write_after_answer)
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
    expect(view.text()).toContain(en.accounts.reconcile.recounting)
    expectNotNow(view, en.accounts.reconcile.write_after_recount)
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
    expect(view.text()).toContain(en.accounts.reconcile.recounting)
    expectNotNow(view, en.accounts.reconcile.write_after_recount)

    // Behind a question of «Поход»: not waited on, named, and nothing written over it.
    trips.elsewhere = { tripId: TRIP, place: 'Ереван Сити', mine: 'Рынок' }
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('8800')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.text()).not.toContain(en.accounts.reconcile.recounting)
    expectNotNow(view, en.accounts.reconcile.write_after_answer)
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
    // Not now in the kit's one look, in the focus order, saying why (Ф-6).
    expectNotNow(view, en.accounts.reconcile.wait_online)
    expect(view.find('[role="alert"]').exists()).toBe(false)
    expect(view.getComponent(StatusStrip).props()).toMatchObject({
      kind: 'offline',
      text: en.accounts.reconcile.offline,
    })
    await button(view, en.accounts.reconcile.wait_online)?.trigger('click')
    expect(checkAccount).not.toHaveBeenCalled()
  })

  it('«Записать разницу» is tinted, and live once nothing waits — no word of waiting (must not fire)', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    const write = button(view, en.accounts.reconcile.write_difference)
    expect(write?.classes()).toContain('tinted')
    expect(write?.attributes('aria-disabled')).toBeUndefined()
    expect(write?.attributes('disabled')).toBeUndefined()
    for (const word of ['write_wait_online', 'write_after_recount', 'write_after_answer'] as const)
      expect(view.text()).not.toContain(en.accounts.reconcile[word])
  })

  it('offline on step two the connection is named first, before the recount it holds back (Ф-6)', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const pinia = withAccounts([cash])
    const view = await reconcile(pinia)
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    view.findComponent(OperationSheet).vm.$emit('saved')
    await flushPromises()
    expectNotNow(view, en.accounts.reconcile.write_after_recount)

    await view.setProps({ online: false })
    expectNotNow(view, en.accounts.reconcile.write_wait_online)
    expect(view.findAllComponents(StatusStrip)).toHaveLength(1)
    // A tap on what cannot be pressed writes nothing.
    await button(view, en.accounts.reconcile.write_wait_online)?.trigger('click')
    expect(useSpendingQueueStore(pinia).pending).toHaveLength(0)
  })

  it('adversarial А1: «Повторить» of «Прочее» waits for the recount as the button does', async () => {
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
    await button(view, en.accounts.reconcile.write_difference)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.no_other)
    // Control: before anything was put right, «Повторить» is there and writes.
    expect(button(view, en.state.retry)).toBeDefined()

    // A reason put right in its own sheet: the count is stale until it lands.
    view.findComponent(OperationSheet).vm.$emit('saved')
    await flushPromises()
    expectNotNow(view, en.accounts.reconcile.write_after_recount)
    // «Повторить» waits too, not now and saying why on itself (Б2: kept, not gone; В1).
    expectNotNow(view, en.accounts.reconcile.retry_after_recount)
    spendingCategories.mockResolvedValue({ categories })
    await button(view, en.accounts.reconcile.retry_after_recount)?.trigger('click')
    await flushPromises()
    // Every way in waits, not only the buttons drawn: the write itself refuses a stale count.
    await (view.vm as unknown as { writeDifference: () => Promise<void> }).writeDifference()
    await flushPromises()
    const records = () =>
      useSpendingQueueStore(pinia).pending.filter((one) => one.kind === 'record')
    expect(records()).toHaveLength(0)
  })

  it('adversarial А2: what was typed stays while no answer came — not across an answer or another account', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    const field = () => (view.get('input').element as HTMLInputElement).value
    const reopen = async (props: Record<string, unknown> = {}) => {
      await view.setProps({ open: false })
      await view.setProps({ ...props, open: true })
      await flushPromises()
    }

    // Answered, the next check starts afresh.
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.difference)
    await reopen()
    expect(field()).toBe('')

    // Offline: closed to come back with the connection, as the line says — what was typed stays.
    await view.setProps({ online: false })
    await view.get('input').setValue('6500')
    await reopen({ online: true })
    expect(field()).toBe('6500')

    // A fact is of its account.
    await reopen({ account: account('Card ֏') })
    expect(field()).toBe('')
  })

  it('review Р2-4, adversarial А2б: offline over an answered check the line says what waits', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await view.setProps({ online: false })
    expect(view.getComponent(StatusStrip).props('text')).toBe(en.accounts.reconcile.offline_result)
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    expect(view.getComponent(StatusStrip).props('text')).toBe(en.accounts.reconcile.offline)
  })

  it('review Р3-1, adversarial Б1: offline over «Сходится» or a difference written, nothing to write is offered', async () => {
    checkAccount.mockResolvedValue(answer('190132', '190132'))
    const even = await reconcile(withAccounts([cash]))
    await even.get('input').setValue('190132')
    await button(even, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await even.setProps({ online: false })
    expect(even.getComponent(StatusStrip).props('text')).toBe(en.accounts.reconcile.offline_counted)

    // An income written for a difference above zero; the recount waits for the connection.
    checkAccount.mockResolvedValue(answer('195000', '190132'))
    const above = await reconcile(withAccounts([cash]))
    await above.get('input').setValue('195000')
    await button(above, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await above.setProps({ online: false })
    // Control: the difference still waits to be written — the line says so.
    expect(above.getComponent(StatusStrip).props('text')).toBe(en.accounts.reconcile.offline_result)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    ;(above.vm as unknown as { incomeSaved: () => void }).incomeSaved()
    await flushPromises()
    expect(above.getComponent(StatusStrip).props('text')).toBe(
      en.accounts.reconcile.offline_counted,
    )
  })

  it('adversarial Б2: «Повторить» of «Прочее» goes not now as the connection drops, and keeps the focus', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    spendingCategories.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'down', true))
    const pinia = withAccounts([cash])
    const view = await mounted(
      ReconcileSheet,
      { open: true, account: cash, categories: [], nameOf: () => 'Other', accountName: () => null },
      pinia,
    )
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await button(view, en.accounts.reconcile.write_difference)?.trigger('click')
    await flushPromises()
    const retry = button(view, en.state.retry)
    expect(retry?.attributes('aria-disabled')).toBeUndefined()
    ;(retry?.element as HTMLElement).focus()

    await view.setProps({ online: false })
    expectNotNow(view, en.accounts.reconcile.retry_wait_online)
    expect(document.activeElement).toBe(
      button(view, en.accounts.reconcile.retry_wait_online)?.element,
    )
  })

  it('adversarial В2: «Повторить» of a recount offline is not now and says why — online it asks again', async () => {
    checkAccount.mockResolvedValueOnce(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    // A recount that failed: «Не удалось сверить» with «Повторить».
    checkAccount.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'down', true))
    await (view.vm as unknown as { recount: (say: boolean) => Promise<void> }).recount(true)
    await flushPromises()
    expect(view.text()).toContain(en.accounts.reconcile.failed)
    // Control: with the connection it is live.
    expect(button(view, en.state.retry)?.attributes('aria-disabled')).toBeUndefined()

    await view.setProps({ online: false })
    expectNotNow(view, en.accounts.reconcile.retry_wait_online)
    await button(view, en.accounts.reconcile.retry_wait_online)?.trigger('click')
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(2)

    // Back online, «Повторить» asks again (review Р5-2).
    checkAccount.mockResolvedValueOnce(answer('185000', '190132'))
    await view.setProps({ online: true })
    await button(view, en.state.retry)?.trigger('click')
    await flushPromises()
    expect(checkAccount).toHaveBeenCalledTimes(3)
    expect(view.text()).not.toContain(en.accounts.reconcile.failed)
  })

  it('adversarial Б3: a fact typed after «Ввести другую сумму» is gone with the sheet — the count was in sight', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await view.get('input').setValue('190132')
    await view.setProps({ open: false })
    await view.setProps({ open: true })
    await flushPromises()
    expect((view.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('tells the screen its step: the fact, the answer, the fact again (Ф-33)', async () => {
    checkAccount.mockResolvedValue(answer('185000', '190132'))
    const view = await reconcile(withAccounts([cash]))
    expect(view.emitted('step')).toBeUndefined()
    await view.get('input').setValue('185000')
    await button(view, en.accounts.reconcile.check)?.trigger('click')
    await flushPromises()
    expect(view.emitted('step')).toEqual([['result']])
    await button(view, en.accounts.reconcile.edit_fact)?.trigger('click')
    await flushPromises()
    expect(view.emitted('step')).toEqual([['result'], ['fact']])
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
      .findAll('.app-field')
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

  // MOL-225, adversarial Р1-А1: «Удалить» and «Сохранить» share one write. The pressed one says its
  // work and keeps the focus; «Сохранить» is not now, and says no «Сохраняем…» nobody asked for.
  it('«Delete account» on a slow line says «Deleting…» and keeps the focus; «Save» is not now and silent', async () => {
    const spare = account('Spare')
    removeMoneyAccount.mockReturnValue(new Promise(() => undefined))
    const view = await mounted(
      AccountSheet,
      { open: true, account: spare, spendCurrency: 'AMD' },
      withAccounts([spare]),
    )
    const remove = button(view, en.accounts.sheet.delete)
    if (!remove) throw new Error('no «Delete account»')
    ;(remove.element as HTMLButtonElement).focus()
    await remove.trigger('click')
    await flushPromises()

    expect(remove.text()).toBe(en.accounts.sheet.deleting)
    expect(remove.attributes('aria-busy')).toBe('true')
    expect(remove.attributes('disabled')).toBeUndefined()
    expect(document.activeElement).toBe(remove.element)
    const save = button(view, en.accounts.sheet.save)
    expect(save?.attributes('aria-busy')).toBeUndefined()
    expect(save?.attributes('aria-disabled')).toBe('true')
    expect(button(view, en.accounts.sheet.saving)).toBeUndefined()
  })

  // Р1-А3: the line drops while the write hangs. The button at work keeps the focus — a native
  // `disabled` would put it on the page — and its glyph: no «no network» beside «Сохраняем…».
  it('the connection gone while «Save» works: the button keeps the focus, its word and its glyph', async () => {
    const card = account('Card ₽', 'RUB')
    const view = await mounted(
      AccountSheet,
      { open: true, account: card, spendCurrency: 'AMD' },
      withAccounts([card]),
    )
    const { api } = await import('@/api')
    ;(api as unknown as Record<string, unknown>).amendMoneyAccount = vi.fn(
      () => new Promise(() => undefined),
    )
    const save = button(view, en.accounts.sheet.save)
    if (!save) throw new Error('no «Save»')
    const glyph = save.get('.glyph').html()
    ;(save.element as HTMLButtonElement).focus()
    await save.trigger('click')
    await flushPromises()
    expect(save.text()).toBe(en.accounts.sheet.saving)

    await view.setProps({ online: false })
    expect(save.attributes('disabled')).toBeUndefined()
    expect(save.attributes('aria-busy')).toBe('true')
    expect(save.text()).toBe(en.accounts.sheet.saving)
    expect(save.get('.glyph').html()).toBe(glyph)
    expect(document.activeElement).toBe(save.element)
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
    expectNotNow(view, en.accounts.sheet.wait_online)
  })

  /** The field of the amount and the line under it, as a reader meets them. */
  function startOf(view: VueWrapper) {
    const field = view
      .findAll('.app-field')
      .find((one) => one.find('input[inputmode="decimal"]').exists())
    if (!field) throw new Error('no amount field')
    const input = field.get('input')
    const hint = (input.attributes('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id))
      .find((one) => one?.classList.contains('hint'))
    return { label: field.get('label').text(), input, hint: hint?.textContent.trim() ?? null }
  }

  // Ф-31: «Остаток» is what lies on the account now, so the field of an amendment is its start, and
  // the server's balance stands under it — read with the field, never worked out from what is typed.
  it('an amendment: «Held at the start», the server’s balance under it, as the field’s description', async () => {
    const card = account('Card $', 'USD', {
      start: parseMoney('8920', 'USD'),
      balance: parseMoney('8470.12', 'USD'),
      hasOperations: true,
    })
    const view = await mounted(
      AccountSheet,
      { open: true, account: card, spendCurrency: 'AMD' },
      withAccounts([card]),
    )
    const start = startOf(view)
    expect(start.label).toBe(en.accounts.sheet.start_amount)
    expect(start.hint).toBe('now $8,470.12')

    // Р-3: what is typed moves nothing on the phone — «now» is what is recorded.
    await start.input.setValue('9000')
    expect(startOf(view).hint).toBe('now $8,470.12')
  })

  it('«now» below zero takes the minus sign, and a removed account says it too (Р-1, Р-4)', async () => {
    const card = account('Credit card', 'RUB', {
      balance: { minor: -1_240_050n, currency: 'RUB' },
      hasOperations: true,
      archivedAt: new Date('2026-10-01T10:00:00Z'),
    })
    const view = await mounted(
      AccountSheet,
      { open: true, account: card, spendCurrency: 'AMD' },
      withAccounts([card]),
    )
    const start = startOf(view)
    expect(start.label).toBe(en.accounts.sheet.start_amount)
    expect(start.hint).toBe('now \u2212₽12,400.50')
    expect(button(view, en.accounts.sheet.archive)).toBeUndefined()
    expect(button(view, en.accounts.sheet.delete)).toBeUndefined()
  })

  it('a new account: «Balance», with no «now» and nothing more describing the field (must not fire)', async () => {
    const view = await mounted(AccountSheet, { open: true, spendCurrency: 'AMD' }, withAccounts([]))
    const start = startOf(view)
    expect(start.label).toBe(en.accounts.balance)
    expect(start.hint).toBeNull()
    expect(start.input.attributes('aria-describedby') ?? '').not.toMatch(/-now\b/)
    expect(view.text()).not.toContain('now ')
  })

  // Owner's «б» on self-review Р1-1 (adversarial А2): «now» is what is recorded, in the account's own
  // currency while another is chosen — the price is named, not hidden.
  it('another currency chosen: «now» stays as recorded, in the account’s currency', async () => {
    const card = account('Card ₽', 'RUB', {
      start: parseMoney('5000', 'RUB'),
      balance: parseMoney('5000', 'RUB'),
    })
    const view = await mounted(
      AccountSheet,
      { open: true, account: card, spendCurrency: 'AMD' },
      withAccounts([card]),
    )
    await view.get('select').setValue('USD')
    expect(startOf(view).hint).toBe('now ₽5,000')
  })

  it('after a conflict «now» is the balance of the version read again (Р-2)', async () => {
    const card = account('Card ₽', 'RUB', { balance: parseMoney('5000', 'RUB') })
    const view = await mounted(
      AccountSheet,
      { open: true, account: card, spendCurrency: 'AMD' },
      withAccounts([card]),
    )
    expect(startOf(view).hint).toBe('now ₽5,000')
    const { api } = await import('@/api')
    ;(api as unknown as Record<string, unknown>).amendMoneyAccount = vi
      .fn()
      .mockRejectedValue(new ApiError(ERROR.CONFLICT, 'revision'))
    moneyAccounts.mockResolvedValue(
      page([{ ...card, balance: parseMoney('4200', 'RUB'), revision: 2 }]),
    )
    await button(view, en.accounts.sheet.save)?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.accounts.sheet.conflict)
    expect(startOf(view).hint).toBe('now ₽4,200')
  })

  // Ф-34 by its pattern: «Put away» loses nothing and is quiet; «Delete account» deletes for good.
  it('«Put away» is a ghost, «Delete account» stays danger-ghost', async () => {
    const used = account('Card $', 'USD', { hasOperations: true })
    const spare = account('Spare')
    const archive = await mounted(
      AccountSheet,
      { open: true, account: used, spendCurrency: 'AMD' },
      withAccounts([used, spare]),
    )
    expect(button(archive, en.accounts.sheet.archive)?.classes()).toContain('ghost')
    expect(button(archive, en.accounts.sheet.archive)?.classes()).not.toContain('danger-ghost')
    archive.unmount()
    const remove = await mounted(
      AccountSheet,
      { open: true, account: spare, spendCurrency: 'AMD' },
      withAccounts([used, spare]),
    )
    expect(button(remove, en.accounts.sheet.delete)?.classes()).toContain('danger-ghost')
  })

  // Ф-6, С-11, owner's В-1 «а»: offline the kit's one strip comes first in the sheet, and every
  // button is not now in the focus order, saying why on itself — a tap sends nothing.
  it.each([
    {
      hasOperations: true,
      word: en.accounts.sheet.archive_offline,
      live: en.accounts.sheet.archive,
    },
    {
      hasOperations: false,
      word: en.accounts.sheet.delete_offline,
      live: en.accounts.sheet.delete,
    },
  ])(
    'offline: one strip first, «Save» and «$live» not now saying why, nothing sent',
    async ({ hasOperations, word, live }) => {
      const card = account('Card ₽', 'RUB', { hasOperations })
      const amendMoneyAccount = vi.fn()
      const { api } = await import('@/api')
      ;(api as unknown as Record<string, unknown>).amendMoneyAccount = amendMoneyAccount
      const view = await mounted(
        AccountSheet,
        { open: true, account: card, spendCurrency: 'AMD', online: false },
        withAccounts([card]),
      )
      const strips = view.findAllComponents(StatusStrip)
      expect(strips).toHaveLength(1)
      expect(strips[0]?.props()).toMatchObject({ kind: 'offline', text: en.accounts.sheet.offline })
      const form = view.get('form').element
      expect(
        strips[0]?.element.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(form.contains(strips[0]?.element ?? null)).toBe(false)

      expectNotNow(view, en.accounts.sheet.wait_online)
      expectNotNow(view, word)
      expect(button(view, word)?.classes()).toContain(hasOperations ? 'ghost' : 'danger-ghost')
      await button(view, en.accounts.sheet.wait_online)?.trigger('click')
      await button(view, word)?.trigger('click')
      await flushPromises()
      expect(amendMoneyAccount).not.toHaveBeenCalled()
      expect(removeMoneyAccount).not.toHaveBeenCalled()

      await view.setProps({ online: true })
      expect(view.findAllComponents(StatusStrip)).toHaveLength(0)
      for (const text of [en.accounts.sheet.save, live]) {
        expect(button(view, text)?.attributes('aria-disabled'), text).toBeUndefined()
        expect(button(view, text)?.attributes('disabled'), text).toBeUndefined()
      }
    },
  )
})
