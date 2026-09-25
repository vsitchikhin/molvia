import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { IncomeAmendBody, IncomeBody, IncomeView, IncomesResponse } from '@molvia/model'
import IncomeSheet from './IncomeSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

const record = vi.fn<(body: IncomeBody) => Promise<unknown>>()
const amend = vi.fn<(id: string, body: IncomeAmendBody) => Promise<'saved' | 'conflict' | 'gone'>>()

const INCOME = '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d'
const EXCHANGE = '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d'

function overview(patch: Partial<IncomesResponse> = {}): IncomesResponse {
  return {
    base: 'RUB',
    baseSince: null,
    months: [],
    // Drams bought with roubles on the 1st: they have a price from then on.
    receipts: [{ id: EXCHANGE, currency: 'AMD', on: '2026-09-01', priced: true }],
    heldEstimates: [
      { held: { minor: 2_000_000n, currency: 'AMD' }, whole: true, from: 'exchange' },
    ],
    ...patch,
  }
}

const amended: IncomeView = {
  id: INCOME,
  receivedOn: '2026-09-15',
  amount: { minor: 9_961_500n, currency: 'RUB' },
  heldBefore: null,
  source: 'salary',
  note: 'Vikasa',
  revision: 2,
  amendedAt: new Date('2026-09-25T09:00:00.000Z'),
  history: [
    {
      amount: { minor: 9_900_000n, currency: 'RUB' },
      receivedOn: '2026-09-15',
      heldBefore: null,
      source: 'bonus',
      note: null,
      replacedAt: new Date('2026-09-25T09:00:00.000Z'),
    },
  ],
}

let clock = 0

beforeEach(() => {
  setActivePinia(createPinia())
  record.mockReset()
  amend.mockReset()
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function render(
  state: IncomesResponse = overview(),
  editing: IncomeView | null = null,
): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/incomes')
  const view = mount(IncomeSheet, {
    props: { open: true, overview: state, record, amend, editing },
    attachTo: document.body,
    global: { plugins: [router, createPinia(), createAppI18n('en')] },
  })
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

function field(view: VueWrapper, label: string) {
  const found = view.findAll('.field').find((one) => one.text().includes(label))
  if (!found) throw new Error(`no field «${label}»`)
  return found
}

async function fill(view: VueWrapper, amount: string, currency = 'RUB', source = 'salary') {
  await field(view, en.income.sheet.amount).get('input').setValue(amount)
  await field(view, en.income.sheet.currency).get('select').setValue(currency)
  if (source) await field(view, en.income.sheet.source).get('select').setValue(source)
}

async function save(view: VueWrapper, label = en.income.sheet.save): Promise<void> {
  const button = view.findAll('button').find((one) => one.text() === label)
  await button?.trigger('click')
  await flushPromises()
}

describe('IncomeSheet', () => {
  it('records the amount in the currency of conversion by default, with its source', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await field(view, en.income.sheet.amount).get('input').setValue('99615')
    await field(view, en.income.sheet.source).get('select').setValue('salary')
    await save(view)
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { minor: 9_961_500n, currency: 'RUB' },
        source: 'salary',
      }),
    )
    const [body] = record.mock.calls[0] ?? []
    expect(body?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(body && 'heldBefore' in body).toBe(false)
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('refuses without a source or an amount, under their fields (В-3)', async () => {
    const view = await render()
    await fill(view, '0', 'RUB', '')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(field(view, en.income.sheet.source).text()).toContain(en.income.sheet.no_source)
    expect(field(view, en.income.sheet.amount).text()).toContain(en.error.invalid_amount)
  })

  it('asks what was held only for a currency that has a price that day, never the base', async () => {
    const view = await render()
    await fill(view, '200000', 'RUB')
    expect(view.text()).not.toContain('held before it came in')
    await fill(view, '200000', 'AMD')
    expect(view.text()).toContain('held before it came in')
    expect(view.text()).toContain('By the recorded spending ≈')
    // Before the drams had a price, nothing held weighs anything.
    await field(view, en.income.sheet.day).get('input').setValue('2026-08-30')
    expect(view.text()).not.toContain('held before it came in')
    // Dollars were never bought: the first money into them is valued alone.
    await fill(view, '500', 'USD')
    expect(view.text()).not.toContain('held before it came in')
  })

  it('asks nothing before the currency of conversion was chosen — the bank is not asked then', async () => {
    const view = await render(overview({ baseSince: '2026-09-10' }))
    await fill(view, '200000', 'AMD')
    await field(view, en.income.sheet.day).get('input').setValue('2026-09-05')
    expect(view.text()).not.toContain('held before it came in')
    await field(view, en.income.sheet.day).get('input').setValue('2026-09-12')
    expect(view.text()).toContain('held before it came in')
  })

  it('sends what was held in the currency that came in', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await fill(view, '200000', 'AMD')
    await field(view, 'held before it came in').get('input').setValue('115000')
    await save(view)
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      heldBefore: { minor: 11_500_000n, currency: 'AMD' },
    })
  })

  it('says money bought with the base is an exchange — for any currency but the base (Р-6)', async () => {
    const view = await render()
    const hint = en.income.sheet.bought_hint.replace('{base}', '₽')
    await fill(view, '1', 'RUB')
    expect(view.text()).not.toContain(hint)
    await fill(view, '1', 'USD')
    expect(view.text()).toContain(hint)
  })

  it('a day the server says has not come yet is said under the day', async () => {
    record.mockRejectedValue(new ApiError(ERROR.INCOME_IN_FUTURE))
    const view = await render()
    await fill(view, '1')
    await save(view)
    expect(field(view, en.income.sheet.day).text()).toContain(en.error.income_in_future)
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('any other failure is said once, and the sheet stays with what was typed', async () => {
    record.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await fill(view, '1')
    await save(view)
    expect(view.text()).toContain(en.income.failed)
    expect(view.emitted('update:open')).toBeUndefined()
  })

  it('an amendment starts from the row, shows the versions and saves over its version', async () => {
    amend.mockResolvedValue('saved')
    const view = await render(overview(), amended)
    expect(view.text()).toContain(en.income.sheet.title_amend)
    expect(
      (field(view, en.income.sheet.amount).get('input').element as HTMLInputElement).value,
    ).toBe('99615')
    expect(view.get('.versions').text()).toContain(en.income.source.bonus)
    await field(view, en.income.sheet.amount).get('input').setValue('102345')
    await save(view, en.income.sheet.save_amend)
    expect(record).not.toHaveBeenCalled()
    expect(amend).toHaveBeenCalledWith(INCOME, {
      revision: 2,
      amount: { minor: 10_234_500n, currency: 'RUB' },
      receivedOn: '2026-09-15',
      source: 'salary',
      note: 'Vikasa',
    })
  })

  it('a conflict keeps the sheet open and names what is recorded now', async () => {
    amend.mockResolvedValue('conflict')
    const view = await render(overview(), amended)
    await save(view, en.income.sheet.save_amend)
    expect(view.emitted('update:open')).toBeUndefined()
    expect(view.text()).toContain(en.income.sheet.amend_conflict)
    expect(view.get('.current').text()).toContain('Now recorded:')
    expect(view.get('.current').text()).toContain(en.income.source.salary)
  })
})
