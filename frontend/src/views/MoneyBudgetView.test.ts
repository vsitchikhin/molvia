import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type { BudgetPlanBody, MoneyBudgetView } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import MoneyBudgetViewScreen from './MoneyBudgetView.vue'

const moneyBudget = vi.fn<(month: string) => Promise<MoneyBudgetView>>()
const setBudgetPlan = vi.fn<(body: BudgetPlanBody) => Promise<MoneyBudgetView>>()
vi.mock('@/api', () => ({
  api: {
    moneyBudget: (month: string) => moneyBudget(month),
    setBudgetPlan: (body: BudgetPlanBody) => setBudgetPlan(body),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GROCERIES = 'ffffffff-0000-4000-8000-000000000001'
const CAFE = 'ffffffff-0000-4000-8000-000000000002'
const RENT = 'ffffffff-0000-4000-8000-000000000003'
const TRANSPORT = 'ffffffff-0000-4000-8000-000000000006'
const PETS = 'ffffffff-0000-4000-8000-000000000010'
const amd = (text: string) => parseMoney(text, 'AMD')
const rub = (text: string) => parseMoney(text, 'RUB')
const below = (text: string) => ({ ...amd(text), minor: -amd(text).minor })
const plain = (text: string) => text.replace(/\s/g, ' ')

const category = (id: string, preset: string) => ({
  id,
  preset: preset as 'groceries',
  name: null,
  colour: null,
  archived: false,
})

/** The month of the plan artifact: 482 200 planned, 118 700 left, the café over by 2 500. */
function budget(patch: Partial<MoneyBudgetView> = {}): MoneyBudgetView {
  const row = (
    categoryId: string,
    plan: MoneyBudgetView['rows'][number]['plan'],
    planned: string,
    spent: string,
    left: ReturnType<typeof amd>,
    used: number,
  ) => ({
    categoryId,
    plan,
    planned: amd(planned),
    awaitingIncome: false,
    estimated: plan.kind === 'share',
    plannedWhole: true,
    spent: amd(spent),
    spentWhole: true,
    left,
    used,
  })
  return {
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    rows: [
      row(GROCERIES, { kind: 'share', percent: 10 }, '77400', '52300', amd('25100'), 68),
      row(CAFE, { kind: 'share', percent: 5 }, '38700', '41200', below('2500'), 106),
      row(RENT, { kind: 'amount', amount: amd('250000') }, '250000', '250000', amd('0'), 100),
    ],
    unplanned: [{ categoryId: TRANSPORT, spent: amd('6500'), spentWhole: true }],
    total: {
      planned: amd('366100'),
      spent: amd('343500'),
      left: amd('22600'),
      unplanned: amd('6500'),
      leftIncome: rub('5256'),
      whole: true,
    },
    savings: {
      target: 25,
      income: rub('180000'),
      difference: rub('93200'),
      actual: 52,
    },
    categories: [
      category(GROCERIES, 'groceries'),
      category(CAFE, 'cafe'),
      category(RENT, 'rent'),
      category(TRANSPORT, 'transport'),
      category(PETS, 'pets'),
    ],
    ...patch,
  }
}

function total(): NonNullable<MoneyBudgetView['total']> {
  const value = budget().total
  if (!value) throw new Error('no total')
  return value
}

let router: Router
let clock = 0
const views: VueWrapper[] = []

async function render(path = '/money/budget'): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(MoneyBudgetViewScreen, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function rowTexts(view: VueWrapper): string[] {
  return view.findAll('li .row').map((row) => plain(row.text()))
}

/** Presses a button of the open sheet until what it does has happened: it takes no tap until up. */
async function pressUntil(text: string, happened: () => void): Promise<void> {
  await vi.waitFor(() => {
    clock += 1000
    const found = [...document.querySelectorAll('dialog[open] button')].find(
      (one) => one.textContent.trim() === text,
    )
    if (found instanceof HTMLButtonElement) found.click()
    happened()
  })
}

function type(selector: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`dialog[open] ${selector}`)
  if (!input) throw new Error(`no ${selector} in the sheet`)
  input.value = value
  input.dispatchEvent(new Event('input'))
}

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
  moneyBudget.mockReset()
  setBudgetPlan.mockReset()
  setBudgetPlan.mockResolvedValue(budget())
  online(true)
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

describe('MoneyBudgetView: the four states (MOL-117)', () => {
  it('loads with a skeleton and asks for the running month of the phone', async () => {
    moneyBudget.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(moneyBudget).toHaveBeenCalledWith('2026-09')
  })

  it('asks for the month the address names, and never one still to come', async () => {
    moneyBudget.mockResolvedValue(budget({ month: '2026-08' }))
    await render('/money/budget?month=2026-08')
    expect(moneyBudget).toHaveBeenLastCalledWith('2026-08')
    await render('/money/budget?month=2026-12')
    expect(moneyBudget).toHaveBeenLastCalledWith('2026-09')
  })

  it('an error offers to try again; offline with nothing kept is never red', async () => {
    moneyBudget.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await render()
    expect(failed.text()).toContain(en.budget.load_error.title)

    online(false)
    moneyBudget.mockRejectedValue(new TypeError('network'))
    const offline = await render('/money/budget?month=2026-07')
    expect(offline.text()).toContain(en.budget.offline_body)
    expect(offline.text()).not.toContain(en.budget.load_error.title)
  })

  it('offline over a month kept on the phone is a strip under the switcher', async () => {
    moneyBudget.mockResolvedValue(budget())
    await render()
    online(false)
    moneyBudget.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.find('.strip').exists()).toBe(true)
    expect(rowTexts(view)).toHaveLength(4)
  })

  it('with no plan offers one, and «Задать план» stands under it', async () => {
    moneyBudget.mockResolvedValue(
      budget({
        rows: [],
        total: null,
        unplanned: [],
        savings: { target: null, income: rub('0'), difference: null, actual: null },
      }),
    )
    const view = await render()
    expect(view.text()).toContain(en.budget.empty.title)
    expect(view.text()).toContain(en.budget.add)
  })
})

describe('MoneyBudgetView: the month counted by the server', () => {
  it('says what is left, the rows in the order of the chips, the over one as such', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const total = plain(view.find('.total').text())
    expect(total).toContain(en.budget.total.left)
    expect(total).toContain('֏22,600')
    expect(total).toContain('≈ ₽5,256')
    expect(rowTexts(view).slice(0, 3)).toEqual([
      'Groceries֏25,100֏52,300 of ≈ ֏77,400 · 10 % of income68%',
      'Cafés and restaurants֏2,500֏41,200 of ≈ ֏38,700 · 5 % of incomeover the plan',
      'Rent֏0֏250,000 of ֏250,000100%',
    ])
    expect(view.findAll('.fill.over')).toHaveLength(1)
    expect(view.text()).toContain(en.budget.unplanned)
    expect(rowTexts(view)[3]).toBe('Transport֏6,500')
  })

  it('a total over the plan is said as such, never as a minus', async () => {
    const total = {
      planned: amd('250000'),
      spent: amd('260000'),
      left: below('10000'),
      unplanned: amd('0'),
      leftIncome: null,
      whole: true,
    }
    moneyBudget.mockResolvedValue(budget({ total }))
    const shown = plain((await render()).find('.total').text())
    expect(shown).toContain(en.budget.total.over)
    expect(shown).toContain('֏10,000')
    expect(shown).not.toContain('−')
  })

  it('the savings: the target, what is put aside so far in a running month', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const savings = plain(view.find('section .row').text())
    expect(savings).toContain(en.budget.savings.title)
    expect(savings).toContain('52% so far')
    expect(savings).toContain('Target — 25 % of income')
    expect(savings).toContain('Difference ₽93,200 of ₽180,000')
  })
})

describe('MoneyBudgetView: a plan written from the month on (В-1)', () => {
  it('a row opens its plan, and «Save» sends the sum from this month, then reads it again', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.findAll('li .row')[2]?.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      'From September on. August stays as it was',
    )
    type('input[inputmode=decimal]', '270 000')
    const written = budget({ total: { ...total(), left: amd('2600') } })
    setBudgetPlan.mockResolvedValue(written)
    await pressUntil(en.budget.sheet.save, () => {
      expect(setBudgetPlan).toHaveBeenCalledWith({
        categoryId: RENT,
        from: '2026-09',
        plan: { kind: 'amount', amount: amd('270000') },
      })
    })
    // The write's own answer is shown, with no second read (review 6).
    await vi.waitFor(() => {
      expect(plain(view.find('.total').text())).toContain('֏2,600')
    })
    expect(moneyBudget).toHaveBeenCalledTimes(1)
  })

  it('a share is a whole percent; past a hundred is refused under the field', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.findAll('li .row')[0]?.trigger('click')
    await flushPromises()
    type('input[inputmode=numeric]', '101')
    await pressUntil(en.budget.sheet.save, () => {
      expect(document.querySelector('dialog[open]')?.textContent).toContain(
        'Enter a whole number from 0 to 100',
      )
    })
    expect(setBudgetPlan).not.toHaveBeenCalled()
    type('input[inputmode=numeric]', '12')
    await pressUntil(en.budget.sheet.save, () => {
      expect(setBudgetPlan).toHaveBeenCalledWith({
        categoryId: GROCERIES,
        from: '2026-09',
        plan: { kind: 'share', percent: 12 },
      })
    })
  })

  it('«Убрать план» sends no plan from this month on', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.findAll('li .row')[1]?.trigger('click')
    await flushPromises()
    await pressUntil(en.budget.sheet.remove, () => {
      expect(setBudgetPlan).toHaveBeenCalledWith({ categoryId: CAFE, from: '2026-09', plan: null })
    })
  })

  it('the savings target is a percent with no category, and no choice of a sum', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.find('section .row').trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open] fieldset')).toBeNull()
    type('input[inputmode=numeric]', '30')
    await pressUntil(en.budget.sheet.save, () => {
      expect(setBudgetPlan).toHaveBeenCalledWith({
        categoryId: null,
        from: '2026-09',
        plan: { kind: 'share', percent: 30 },
      })
    })
  })

  it('«Задать план» offers only the live categories with no row', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const add = view.findAll('button').find((one) => one.text().includes(en.budget.add))
    await add?.trigger('click')
    await flushPromises()
    const options = [...document.querySelectorAll('dialog[open] option')].map(
      (one) => one.textContent,
    )
    expect(options).toEqual(['Transport', 'Pets'])
  })

  it('must not fire: offline, a plan is not sent and the button says it waits', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await view.findAll('li .row')[2]?.trigger('click')
    await flushPromises()
    const save = [...document.querySelectorAll('dialog[open] button')].find((one) =>
      one.textContent.includes(en.budget.sheet.wait_online),
    )
    expect(save?.hasAttribute('disabled')).toBe(true)
    expect(setBudgetPlan).not.toHaveBeenCalled()
  })
})

describe('MoneyBudgetView: what the review found (MOL-117)', () => {
  it('a share of an empty «Пришло» waits for it: no minus, nothing over, the total says why', async () => {
    const [groceries] = budget().rows
    if (!groceries) throw new Error('no row')
    moneyBudget.mockResolvedValue(
      budget({
        rows: [
          {
            ...groceries,
            planned: null,
            awaitingIncome: true,
            estimated: false,
            left: null,
            used: null,
          },
        ],
        total: { ...total(), whole: false },
      }),
    )
    const view = await render()
    expect(rowTexts(view)[0]).toBe('Groceries—֏52,300 of — · 10 % of income · nothing came in yet')
    expect(view.findAll('.over')).toHaveLength(0)
    expect(view.find('.total').text()).toContain(en.budget.total.awaiting)
  })

  it('a spending short of a rate is said on its row (review 3)', async () => {
    const [groceries] = budget().rows
    if (!groceries) throw new Error('no row')
    moneyBudget.mockResolvedValue(
      budget({ rows: [{ ...groceries, spentWhole: false, used: null }] }),
    )
    const view = await render()
    expect(rowTexts(view)[0]).toContain('not all counted')
  })

  it('a removed category with no plan is shown, and no plan is offered for it (review 7)', async () => {
    moneyBudget.mockResolvedValue(
      budget({
        unplanned: [{ categoryId: PETS, spent: amd('1000'), spentWhole: true }],
        categories: budget().categories.map((one) =>
          one.id === PETS ? { ...one, archived: true } : one,
        ),
      }),
    )
    const view = await render()
    expect(view.find('.row.still').text()).toContain('Pets')
    expect(view.find('button.row.still').exists()).toBe(false)
  })

  it('the savings target alone is a plan: no «No plan yet» over it (adversarial Д)', async () => {
    moneyBudget.mockResolvedValue(budget({ rows: [], unplanned: [], total: null }))
    const view = await render()
    expect(view.text()).not.toContain(en.budget.empty.title)
    expect(view.text()).toContain('Target — 25 % of income')
  })

  it('a plan kept from another currency is said, never put in the field as this one (adversarial Б)', async () => {
    const [, , rent] = budget().rows
    if (!rent) throw new Error('no row')
    moneyBudget.mockResolvedValue(
      budget({
        spendCurrency: 'RUB',
        rows: [{ ...rent, plan: { kind: 'amount', amount: amd('250000') }, estimated: true }],
      }),
    )
    const view = await render()
    expect(rowTexts(view)[0]).toContain('of ≈ ')
    await view.findAll('li .row')[0]?.trigger('click')
    await flushPromises()
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.querySelector<HTMLInputElement>('input[inputmode=decimal]')?.value).toBe('')
    expect(sheet?.textContent).toContain('The plan was ֏250,000.00')
    await pressUntil(en.budget.sheet.save, () => {
      expect(sheet?.textContent).toContain('Enter a sum')
    })
    expect(setBudgetPlan).not.toHaveBeenCalled()
  })

  it('a total over by less than a dram says the lumas, never «֏0» (adversarial Г)', async () => {
    moneyBudget.mockResolvedValue(
      budget({ total: { ...total(), left: { minor: -40n, currency: 'AMD' }, leftIncome: null } }),
    )
    const shown = plain((await render()).find('.total').text())
    expect(shown).toContain(en.budget.total.over)
    expect(shown).toContain('֏0.40')
  })
})
