import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { IncomeAmendBody, IncomeBody, IncomeView as Row, IncomesResponse } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import IncomesView from './IncomesView.vue'

const incomes = vi.fn<() => Promise<IncomesResponse>>()
const recordIncome =
  vi.fn<(body: IncomeBody) => Promise<{ incomes: IncomesResponse; created: boolean }>>()
const amendIncome = vi.fn<(id: string, body: IncomeAmendBody) => Promise<IncomesResponse>>()
const removeIncome = vi.fn<(id: string) => Promise<IncomesResponse>>()
const restoreIncome = vi.fn<(id: string) => Promise<IncomesResponse>>()
vi.mock('@/api', () => ({
  api: {
    incomes: () => incomes(),
    recordIncome: (body: IncomeBody) => recordIncome(body),
    amendIncome: (id: string, body: IncomeAmendBody) => amendIncome(id, body),
    removeIncome: (id: string) => removeIncome(id),
    restoreIncome: (id: string) => restoreIncome(id),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function row(patch: Partial<Row> = {}): Row {
  return {
    id: '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
    receivedOn: '2026-09-15',
    amount: { minor: 9_961_500n, currency: 'RUB' },
    heldBefore: null,
    source: 'salary',
    note: null,
    revision: 1,
    amendedAt: null,
    history: [],
    ...patch,
  }
}

function overview(patch: Partial<IncomesResponse> = {}): IncomesResponse {
  return {
    base: 'RUB',
    baseSince: null,
    months: [
      {
        month: '2026-09',
        sums: [{ minor: 9_961_500n, currency: 'RUB' }],
        incomes: [row()],
      },
    ],
    receipts: [],
    heldEstimates: [],
    ...patch,
  }
}

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = ACTOR
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/incomes')
  const view = mount(IncomesView, {
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

let clock = 0

beforeEach(() => {
  vi.restoreAllMocks()
  for (const mock of [incomes, recordIncome, amendIncome, removeIncome, restoreIncome]) {
    mock.mockReset()
  }
  online(true)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

/** Waits for a sheet to rise — until then it takes no tap. */
async function risen(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function sheetButton(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (button) => button.textContent.trim() === text,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no «${text}» in the sheet`)
  return found
}

describe('IncomesView: the four states', () => {
  it('loads with a skeleton, nothing invented', async () => {
    incomes.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.text()).not.toContain(en.income.record)
  })

  it('a failed read is red with «Try again», and trying again reads again', async () => {
    incomes.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(overview())
    const view = await render()
    expect(view.text()).toContain(en.income.load_error.title)
    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain('September 2026')
  })

  it('offline is never red and offers no button — the screen comes back by itself', async () => {
    online(false)
    incomes.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.income.offline.body)
    expect(view.text()).not.toContain(en.state.retry)
  })

  it('without incomes offers to record one, and says nothing else depends on it', async () => {
    incomes.mockResolvedValue(overview({ months: [] }))
    const view = await render()
    expect(view.text()).toContain(en.income.empty.title)
    expect(view.text()).toContain(en.income.empty.body)
    expect(view.text()).toContain(en.income.record)
  })
})

describe('IncomesView: the months (В-2)', () => {
  it('names each month with what came in per currency, as the server summed it', async () => {
    incomes.mockResolvedValue(
      overview({
        months: [
          { month: '2026-09', sums: [{ minor: 9_961_500n, currency: 'RUB' }], incomes: [row()] },
          {
            month: '2026-08',
            sums: [
              { minor: 13_754_000n, currency: 'RUB' },
              { minor: 50_000n, currency: 'USD' },
            ],
            incomes: [
              row({ id: '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2e', receivedOn: '2026-08-31' }),
              row({
                id: '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2f',
                receivedOn: '2026-08-26',
                amount: { minor: 50_000n, currency: 'USD' },
                source: 'freelance',
              }),
            ],
          },
        ],
      }),
    )
    const view = await render()
    const heads = view.findAll('.month-head').map((head) => head.text())
    expect(heads[0]).toMatch(/September 2026.*99,615\.00/)
    expect(heads[1]).toMatch(/August 2026.*137,540\.00.*·.*500\.00/)
    expect(view.text()).toContain(en.income.source.freelance)
  })

  it('a row says the source and the day, marks an amendment and shows its note', async () => {
    incomes.mockResolvedValue(
      overview({
        months: [
          {
            month: '2026-09',
            sums: [{ minor: 9_961_500n, currency: 'RUB' }],
            incomes: [row({ amendedAt: new Date('2026-09-25T09:00:00.000Z'), note: 'Vikasa' })],
          },
        ],
      }),
    )
    const view = await render()
    const button = view.get('button.body')
    // Named by its words: an `aria-label` would silence the source, the day and the note.
    expect(button.attributes('aria-label')).toBeUndefined()
    expect(button.text()).toContain(en.income.edit)
    expect(button.text()).toContain(en.income.source.salary)
    expect(view.get('.amended').text()).toContain('amended')
    expect(view.get('.note').text()).toBe('Vikasa')
  })
})

describe('IncomesView: recording, amending and removing', () => {
  it('records through the sheet and lands the answer', async () => {
    incomes.mockResolvedValue(overview({ months: [] }))
    recordIncome.mockResolvedValue({ incomes: overview(), created: true })
    const view = await render()
    const record = view.findAll('button').find((button) => button.text() === en.income.record)
    await record?.trigger('click')
    await risen()
    const sheet = document.querySelector('dialog[open]')
    const amount = sheet?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    const [, source] = [...(sheet?.querySelectorAll('select') ?? [])]
    if (!amount || !source) throw new Error('no fields')
    amount.value = '99615'
    amount.dispatchEvent(new Event('input'))
    source.value = 'salary'
    source.dispatchEvent(new Event('change'))
    await flushPromises()
    sheetButton(en.income.sheet.save).click()
    await flushPromises()

    expect(recordIncome).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: { minor: 9_961_500n, currency: 'RUB' },
        source: 'salary',
      }),
    )
    expect(view.text()).toContain('September 2026')
  })

  it('a correction sent under the old name is said and the list read again (В-6)', async () => {
    incomes.mockResolvedValue(overview())
    const view = await render()
    recordIncome.mockRejectedValue(new ApiError(ERROR.CONFLICT))
    const record = view.findAll('button').find((button) => button.text() === en.income.record)
    await record?.trigger('click')
    await risen()
    const sheet = document.querySelector('dialog[open]')
    const amount = sheet?.querySelector<HTMLInputElement>('input[inputmode="decimal"]')
    const [, source] = [...(sheet?.querySelectorAll('select') ?? [])]
    if (!amount || !source) throw new Error('no fields')
    amount.value = '1'
    amount.dispatchEvent(new Event('input'))
    source.value = 'other'
    source.dispatchEvent(new Event('change'))
    await flushPromises()
    sheetButton(en.income.sheet.save).click()
    await flushPromises()
    expect(view.text()).toContain(en.income.conflict)
    expect(incomes).toHaveBeenCalledTimes(2)
  })

  it('opens a row for an amendment over its version, and a moved-on version keeps the sheet', async () => {
    incomes.mockResolvedValueOnce(overview()).mockResolvedValue(
      overview({
        months: [
          { month: '2026-09', sums: [], incomes: [row({ revision: 2, note: 'elsewhere' })] },
        ],
      }),
    )
    amendIncome.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
    const view = await render()
    await view.get('button.body').trigger('click')
    await risen()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.income.sheet.title_amend,
    )
    sheetButton(en.income.sheet.save_amend).click()
    await flushPromises()
    expect(amendIncome).toHaveBeenCalledWith(row().id, expect.objectContaining({ revision: 1 }))
    expect(view.text()).toContain(en.income.amend_conflict)
    expect(document.querySelector('dialog[open]')?.textContent).toContain('elsewhere')

    amendIncome.mockResolvedValue(overview())
    sheetButton(en.income.sheet.save_amend).click()
    await flushPromises()
    expect(amendIncome.mock.calls.at(-1)?.[1]).toMatchObject({ revision: 2 })
  })

  it('an income removed elsewhere is said to be gone, not «check the connection»', async () => {
    incomes.mockResolvedValue(overview())
    amendIncome.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const view = await render()
    await view.get('button.body').trigger('click')
    await risen()
    sheetButton(en.income.sheet.save_amend).click()
    await flushPromises()
    expect(view.text()).toContain(en.income.vanished)
    expect(view.text()).not.toContain(en.income.failed)
  })

  it('the bin asks first, then removes, puts the focus on «Bring back» and brings it back', async () => {
    incomes.mockResolvedValue(overview())
    removeIncome.mockResolvedValue(overview({ months: [] }))
    restoreIncome.mockResolvedValue(overview())
    const view = await render()

    const bin = view.get('button.remove')
    expect(bin.attributes('aria-label')).toMatch(/Remove income .*99,615\.00/)
    await bin.trigger('click')
    await risen()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.income.remove_sheet.title,
    )
    expect(removeIncome).not.toHaveBeenCalled()
    sheetButton(en.income.remove_sheet.confirm).click()
    await flushPromises()
    expect(removeIncome).toHaveBeenCalledWith(row().id)
    expect(view.text()).toContain('Income removed')
    expect(document.activeElement?.textContent.trim()).toBe(en.income.restore)

    const restore = view.findAll('button').find((button) => button.text() === en.income.restore)
    await restore?.trigger('click')
    await flushPromises()
    expect(restoreIncome).toHaveBeenCalledWith(row().id)
    expect(view.text()).not.toContain('Income removed')
    expect(document.activeElement?.textContent.trim()).toBe(en.income.record)
  })

  // Whether an income is still part of the rate only the whole walk knows: roubles never are, euros
  // are not until exchanged, an exchange with no remainder starts the rate afresh. So every income
  // is removed with a condition, never a promise (self-review Ч-2, adversarial round 2, Е1).
  it.each(['RUB', 'EUR', 'AMD'] as const)(
    'removing an income in %s says the rate changes only if it was part of it',
    async (currency) => {
      const amount = { minor: 20_000_000n, currency }
      incomes.mockResolvedValue(
        overview({ months: [{ month: '2026-09', sums: [], incomes: [row({ amount })] }] }),
      )
      const view = await render()
      await view.get('button.remove').trigger('click')
      await risen()
      const text = document.querySelector('dialog[open]')?.textContent ?? ''
      expect(text).toContain(en.income.remove_sheet.body)
      expect(text).not.toMatch(/no longer counts/)
    },
  )

  it('«Bring back» after the removal became final says so and reads the list again', async () => {
    incomes.mockResolvedValue(overview())
    removeIncome.mockResolvedValue(overview({ months: [] }))
    restoreIncome.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const view = await render()
    await view.get('button.remove').trigger('click')
    await risen()
    sheetButton(en.income.remove_sheet.confirm).click()
    await flushPromises()
    const restore = view.findAll('button').find((button) => button.text() === en.income.restore)
    await restore?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.income.restore_gone)
    expect(incomes).toHaveBeenCalledTimes(2)
  })

  it('a failed removal is said once and offers nothing to bring back', async () => {
    incomes.mockResolvedValue(overview())
    removeIncome.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await view.get('button.remove').trigger('click')
    await risen()
    sheetButton(en.income.remove_sheet.confirm).click()
    await flushPromises()
    expect(view.text()).toContain(en.income.failed)
    expect(view.text()).not.toContain(en.income.restore)
  })

  it('without a connection shows what it has, and writes nothing', async () => {
    incomes.mockResolvedValue(overview())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(view.text()).toContain(en.income.offline.strip)
    expect(view.get('button.remove').attributes('disabled')).toBeDefined()
    expect(view.get('button.body').attributes('disabled')).toBeDefined()
  })
})
