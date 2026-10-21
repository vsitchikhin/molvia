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
import { useSpendingQueueStore } from '@/stores/spendingQueue'
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
      planShort: false,
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

/** The main action of the strip over the tab bar, in either of its words. */
function addButton(view: VueWrapper) {
  return view
    .findAll('.dock button')
    .find((one) => [en.budget.add, en.budget.add_offline].includes(one.text().trim()))
}

/** The connection's lines of the screen, not of the sheet mounted closed under it. */
function strips(view: VueWrapper) {
  return view.findAll('.strip').filter((one) => !one.element.closest('dialog'))
}

function rowTexts(view: VueWrapper): string[] {
  return view.findAll('li .list-row').map((row) => plain(row.text()))
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
    expect(strips(view)).toHaveLength(1)
    expect(view.find('.strip.offline').text()).toContain('Offline · budget as of')
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

describe('MoneyBudgetView: «Задать план» is the strip, the connection a line (MOL-192)', () => {
  it('the strip stands over an answer only, and opens a new plan', async () => {
    moneyBudget.mockReturnValue(new Promise(() => undefined))
    expect(addButton(await render())).toBeUndefined()

    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const add = addButton(view)
    expect(add?.text()).toBe(en.budget.add)
    // Not in the list any more: one main action, in one place (Ф-28).
    expect(view.find('.content').text()).not.toContain(en.budget.add)
    await add?.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.budget.sheet.title_choose,
    )
  })

  it('offline it is not now and says why; a tap opens nothing', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    const add = addButton(view)
    expect(add?.text()).toBe(en.budget.add_offline)
    expect(add?.attributes('aria-disabled')).toBe('true')
    expect(add?.attributes('disabled')).toBeUndefined()
    await add?.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()

    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(addButton(view)?.text()).toBe(en.budget.add)
  })

  it('must not fire: with every live category planned there is nothing to offer', async () => {
    moneyBudget.mockResolvedValue(
      budget({
        categories: [
          category(GROCERIES, 'groceries'),
          category(CAFE, 'cafe'),
          category(RENT, 'rent'),
          { ...category(TRANSPORT, 'transport'), archived: true },
        ],
      }),
    )
    const view = await render()
    expect(addButton(view)).toBeUndefined()
    expect(view.find('.dock').exists()).toBe(false)
  })

  it('an error with nothing kept takes the strip for «Повторить»', async () => {
    moneyBudget.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()
    expect(addButton(view)).toBeUndefined()
    const retry = view.findAll('.dock button').find((one) => one.text() === en.state.retry)
    expect(retry).toBeDefined()
    moneyBudget.mockResolvedValue(budget())
    await retry?.trigger('click')
    await flushPromises()
    expect(addButton(view)?.text()).toBe(en.budget.add)
  })

  it('offline with nothing kept has no strip: no answer, nothing to plan', async () => {
    online(false)
    moneyBudget.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.budget.offline_body)
    expect(addButton(view)).toBeUndefined()
  })

  it('the server silent over a kept month is one line with «Повторить», the strip kept', async () => {
    moneyBudget.mockResolvedValue(budget())
    await render()
    moneyBudget.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()
    expect(strips(view)).toHaveLength(1)
    const strip = view.find('.strip.unanswered')
    expect(strip.text()).toContain('The server did not answer — budget as of')
    expect(view.text()).not.toContain(en.budget.load_error.title)
    expect(addButton(view)?.text()).toBe(en.budget.add)
    moneyBudget.mockResolvedValue(budget())
    await strip.find('button').trigger('click')
    await flushPromises()
    expect(moneyBudget).toHaveBeenCalledTimes(3)
    expect(strips(view)).toHaveLength(0)
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
      'Groceries֏25,100֏52,300 of ≈ ֏77,400 · 10 % of income · 68%',
      'Cafés and restaurants֏2,500֏41,200 of ≈ ֏38,700 · 5 % of income · over the plan',
      'Rent֏0֏250,000 of ֏250,000 · 100%',
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
      planShort: false,
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
    const savings = plain(view.find('section .list-row').text())
    expect(savings).toContain(en.budget.savings.title)
    expect(savings).toContain('52% so far')
    expect(savings).toContain('Target — 25 % of income')
    expect(savings).toContain('Difference ₽93,200 of ₽180,000')
  })
})

describe("MoneyBudgetView: the rows are the kit's (MOL-192)", () => {
  it("a live row is a button with a chevron, its circle and bar in its category's colour", async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const rows = view.findAll('li .list-row')
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.element.tagName).toBe('BUTTON')
      expect(row.find('.chevron').exists()).toBe(true)
    }
    const groceries = rows[0]
    expect(groceries?.find('.circle').attributes('style')).toContain('var(--cat-groceries)')
    expect(groceries?.find('.fill').attributes('style')).toContain(
      'background: var(--cat-groceries)',
    )
    expect(groceries?.find('.fill').attributes('style')).toContain('width: 68%')
    // Never the accent: terracotta is «press here» (Ф-4).
    expect(view.html()).not.toContain('var(--accent)')
  })

  it("over the plan the bar is the warning's, to the edge, and the words say so", async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const cafe = view.findAll('li .list-row')[1]
    const fill = cafe?.find('.fill')
    expect(fill?.classes()).toContain('over')
    expect(fill?.attributes('style')).toContain('width: 100%')
    expect(fill?.attributes('style')).not.toContain('background')
    expect(cafe?.find('.amount').classes()).toContain('over')
    expect(cafe?.find('.meta .over').text()).toBe('· over the plan')
  })

  it('a row of «Без плана» opens the plan of its own category', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.findAll('li .list-row')[3]?.trigger('click')
    await flushPromises()
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain('Transport')
    expect(sheet?.querySelector('select')).toBeNull()
  })

  it("the savings: a quiet circle, the bar data's own grey, the target a mark", async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    const savings = view.find('section .list-row')
    expect(savings.find('.circle').classes()).toContain('muted')
    expect(savings.find('.chevron').exists()).toBe(true)
    expect(savings.find('.fill').attributes('style')).not.toContain('background')
    expect(savings.find('.mark').attributes('style')).toContain('left: 25%')
  })
})

describe("MoneyBudgetView: the total and the skeleton in the answer's shape (MOL-192)", () => {
  it('loads as the answer stands: the card of a sum, then three rows with their bar', async () => {
    moneyBudget.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton-figure .plate').exists()).toBe(true)
    expect(view.findAll('.skeleton-rows .item')).toHaveLength(3)
    expect(view.findAll('.skeleton-rows .track-bar')).toHaveLength(3)
    expect(view.findAll('.skeleton-rows .circle')).toHaveLength(3)
  })

  it('the total is the card of a sum: a caption, the figure, three tiles', async () => {
    moneyBudget.mockResolvedValue(budget())
    const card = (await render()).find('.total')
    expect(card.find('.section-caption').text()).toBe(en.budget.total.left)
    const tiles = card.findAll('.tile').map((tile) => plain(tile.text()))
    expect(tiles).toEqual(['Plan֏366,100', 'Spent֏343,500', 'Outside the plan֏6,500'])
  })
})

describe('MoneyBudgetView: a plan written from the month on (В-1)', () => {
  it('a row opens its plan, and «Save» sends the sum from this month, then reads it again', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.findAll('li .list-row')[2]?.trigger('click')
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
    await view.findAll('li .list-row')[0]?.trigger('click')
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
    await view.findAll('li .list-row')[1]?.trigger('click')
    await flushPromises()
    await pressUntil(en.budget.sheet.remove, () => {
      expect(setBudgetPlan).toHaveBeenCalledWith({ categoryId: CAFE, from: '2026-09', plan: null })
    })
  })

  it('the savings target is a percent with no category, and no choice of a sum', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.find('section .list-row').trigger('click')
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
    await view.findAll('li .list-row')[2]?.trigger('click')
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
    expect(view.find('div.list-row').text()).toContain('Pets')
    expect(view.find('button .no-chevron').exists()).toBe(false)
    expect(view.find('div.list-row .meta').text()).toBe(en.budget.row.archived)
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
    await view.findAll('li .list-row')[0]?.trigger('click')
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

describe('MoneyBudgetView: round 2 of the review (MOL-117)', () => {
  it('a spending landed while a plan is on its way stays: the month is read once more (Ж)', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    let answer: (value: MoneyBudgetView) => void = () => undefined
    setBudgetPlan.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    await view.findAll('li .list-row')[2]?.trigger('click')
    await flushPromises()
    await pressUntil(en.budget.sheet.save, () => {
      expect(setBudgetPlan).toHaveBeenCalled()
    })

    const [groceries, ...rest] = budget().rows
    if (!groceries) throw new Error('no row')
    const landed = budget({
      rows: [{ ...groceries, spent: amd('60300'), left: amd('17100') }, ...rest],
    })
    moneyBudget.mockResolvedValue(landed)
    useSpendingQueueStore().landed += 1
    await vi.waitFor(() => {
      expect(rowTexts(view)[0]).toContain('֏60,300')
    })

    // The write was counted before the spending landed: its answer is not trusted, the month is read.
    answer(budget())
    await vi.waitFor(() => {
      clock += 1000
      expect(moneyBudget).toHaveBeenCalledTimes(3)
    })
    await flushPromises()
    expect(rowTexts(view)[0]).toContain('֏60,300')
  })

  it('with every share waiting, «осталось» and the plan are a dash, what was spent is said (review 9, З)', async () => {
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
        total: {
          planned: null,
          spent: amd('52300'),
          left: null,
          planShort: true,
          unplanned: amd('6500'),
          leftIncome: null,
          whole: false,
        },
      }),
    )
    const shown = plain((await render()).find('.total').text())
    expect(shown).toContain(`${en.budget.total.left}—`)
    expect(shown).toContain(`${en.budget.total.planned}—`)
    expect(shown).toContain('֏52,300')
    expect(shown).not.toContain('֏0')
  })

  it('a removed category with a plan is shown, and no plan is offered for it (И)', async () => {
    const [, , rent] = budget().rows
    if (!rent) throw new Error('no row')
    moneyBudget.mockResolvedValue(
      budget({
        rows: [{ ...rent, categoryId: PETS }],
        unplanned: [],
        categories: budget().categories.map((one) =>
          one.id === PETS ? { ...one, archived: true } : one,
        ),
      }),
    )
    const view = await render()
    const removed = view.find('li div.list-row')
    expect(removed.text()).toContain('Pets')
    expect(removed.find('.no-chevron').exists()).toBe(true)
    // Not a button and no chevron, and the row says why it does not open (MOL-192).
    expect(removed.element.tagName).toBe('DIV')
    expect(removed.find('.chevron').exists()).toBe(false)
    expect(removed.find('.meta').text()).toContain(en.budget.row.archived)
    expect(removed.find('.track').exists()).toBe(true)
    await removed.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
  })
})

describe('MoneyBudgetView: round 3 of the review (MOL-117)', () => {
  it('says «и ещё» beside a plan some row with a plan is not in (review 12, Л)', async () => {
    moneyBudget.mockResolvedValue(
      budget({ total: { ...total(), planned: amd('250000'), planShort: true } }),
    )
    const shown = plain((await render()).find('.total').text())
    expect(shown).toContain(`${en.budget.total.planned}֏250,000 and more`)
  })

  it('says the lumas of what was spent too, never «֏0» (Г6)', async () => {
    const [groceries] = budget().rows
    if (!groceries) throw new Error('no row')
    moneyBudget.mockResolvedValue(
      budget({
        rows: [
          { ...groceries, spent: { minor: 40n, currency: 'AMD' }, left: amd('77399.60'), used: 0 },
        ],
        unplanned: [
          { categoryId: TRANSPORT, spent: { minor: 40n, currency: 'AMD' }, spentWhole: true },
        ],
      }),
    )
    const view = await render()
    expect(rowTexts(view)[0]).toContain('֏0.40 of')
    expect(rowTexts(view)[1]).toBe('Transport֏0.40')
  })
})

describe('MoneyBudgetView: round 4 of the review (MOL-117)', () => {
  it('says a share waits and a spending is short, both, never one over the other (М)', async () => {
    const [groceries, , rent] = budget().rows
    if (!groceries || !rent) throw new Error('no row')
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
          {
            ...rent,
            planned: amd('10000'),
            spent: amd('5000'),
            left: amd('5000'),
            spentWhole: false,
            used: null,
          },
        ],
        total: {
          ...total(),
          planned: amd('10000'),
          left: amd('5000'),
          planShort: true,
          whole: false,
        },
      }),
    )
    const shown = (await render()).find('.total').text()
    expect(shown).toContain(en.budget.total.awaiting)
    expect(shown).toContain(en.budget.total.not_whole)
  })

  it('must not fire: a share that only waits says no «не всё посчитано»', async () => {
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
        total: { ...total(), planned: null, left: null, planShort: true, whole: false },
      }),
    )
    const shown = (await render()).find('.total').text()
    expect(shown).toContain(en.budget.total.awaiting)
    expect(shown).not.toContain(en.budget.total.not_whole)
  })
})

describe('MoneyBudgetView: round 5 of the review (MOL-117)', () => {
  it('a plan of another currency no rate converts is said on its row and under the total (14, Н)', async () => {
    const [, , rent] = budget().rows
    if (!rent) throw new Error('no row')
    moneyBudget.mockResolvedValue(
      budget({
        rows: [
          {
            ...rent,
            planned: null,
            estimated: true,
            plannedWhole: false,
            spent: amd('0'),
            left: null,
            used: null,
          },
        ],
        total: {
          ...total(),
          planned: amd('10000'),
          left: amd('7000'),
          planShort: true,
          whole: false,
        },
      }),
    )
    const view = await render()
    expect(rowTexts(view)[0]).toContain('not all counted')
    expect(view.find('.total').text()).toContain(en.budget.total.not_whole)
  })
})

describe('MoneyBudgetView: round 6 of the review (MOL-117)', () => {
  it('refuses a plan past ten trillion under the field, and sends nothing (Н)', async () => {
    moneyBudget.mockResolvedValue(budget())
    const view = await render()
    await view.findAll('li .list-row')[2]?.trigger('click')
    await flushPromises()
    type('input[inputmode=decimal]', '10000000000001')
    await pressUntil(en.budget.sheet.save, () => {
      expect(document.querySelector('dialog[open]')?.textContent).toContain(en.budget.sheet.too_big)
    })
    expect(setBudgetPlan).not.toHaveBeenCalled()
  })
})
