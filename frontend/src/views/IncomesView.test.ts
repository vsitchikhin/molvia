import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney } from '@molvia/model'
import type {
  IncomeAmendBody,
  IncomeBody,
  IncomeView as Row,
  IncomesResponse,
  MoneyAccountsResponse,
} from '@molvia/model'
import StatusStrip from '@/components/StatusStrip.vue'
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
const moneyAccounts = vi.fn<() => Promise<MoneyAccountsResponse>>()
vi.mock('@/api', () => ({
  api: {
    incomes: () => incomes(),
    recordIncome: (body: IncomeBody) => recordIncome(body),
    amendIncome: (id: string, body: IncomeAmendBody) => amendIncome(id, body),
    removeIncome: (id: string) => removeIncome(id),
    restoreIncome: (id: string) => restoreIncome(id),
    moneyAccounts: () => moneyAccounts(),
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
    accountId: null,
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
  await router.push('/money/incomes')
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
  // No accounts unless a test names one: the page is never asked otherwise.
  moneyAccounts.mockReset().mockRejectedValue(new TypeError('network'))
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
    // The answer's shape (Ф-13) of a person with no account: a month, a card with a note and one
    // with nothing, a month, a card with a note — no paragraphs of `groups`.
    expect(skeletonShape(view)).toEqual(['month', 1, 0, 'month', 1])
    // The income's card, not an exchange's (adversarial А2), on a root of its own (self-review №1,
    // adversarial Б3): two of them, never a screen's `.cards`.
    const roots = view.findAll('.skeleton-cards')
    expect(roots).toHaveLength(2)
    for (const root of roots) {
      expect(root.classes()).toEqual(['skeleton-cards', 'skeleton-income'])
    }
    expect(view.find('.skeleton-lines').exists()).toBe(false)
  })

  it('with an account every card of the skeleton has its plate, as every income lands on it (Б2)', async () => {
    moneyAccounts.mockResolvedValue({
      spendCurrency: 'RUB',
      accounts: [
        {
          id: '5c1f8b2d-3e4a-4b6c-8d7e-9f0a1b2c3d4e',
          name: 'Card ₽',
          currency: 'RUB',
          savings: false,
          start: parseMoney('1000', 'RUB'),
          startOn: '2026-09-01',
          balance: parseMoney('1000', 'RUB'),
          approximate: false,
          uncounted: 0,
          inSpend: null,
          rate: null,
          lastCheckedOn: null,
          hasOperations: true,
          archivedAt: null,
          revision: 1,
        },
      ],
      totals: {
        total: parseMoney('0', 'RUB'),
        spendable: parseMoney('0', 'RUB'),
        savings: parseMoney('0', 'RUB'),
        uncounted: 0,
      },
      incomeTotals: null,
      unassigned: 0,
      countedAt: new Date(),
    })
    incomes.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    // The account and a note, the account; a month, the account (frame incomes-light).
    expect(skeletonShape(view)).toEqual(['month', 2, 1, 'month', 1])
  })

  it('a failed read is red with «Try again», and trying again reads again', async () => {
    incomes.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(overview())
    const view = await render()
    expect(view.text()).toContain(en.income.load_error.title)
    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain('September')
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
    // The strip's, not a button of the empty state (Ф-16).
    expect(recordButton(view)?.text()).toBe(en.income.record)
    expect(view.get('.state').findAll('button')).toHaveLength(0)
  })

  it('no «Record income» while there is no answer: loading, an error, offline with nothing', async () => {
    incomes.mockReturnValue(new Promise(() => undefined))
    const loading = await render()
    expect(recordButton(loading)).toBeUndefined()

    incomes.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await render()
    expect(failed.text()).toContain(en.income.load_error.title)
    expect(recordButton(failed)).toBeUndefined()

    online(false)
    incomes.mockRejectedValue(new TypeError('network'))
    const offline = await render()
    expect(offline.text()).toContain(en.income.offline.body)
    expect(recordButton(offline)).toBeUndefined()
  })
})

describe('IncomesView: the months (В-2)', () => {
  it('names each month with what came in per currency, as the server summed it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-18T09:00:00Z'))
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
          {
            month: '2025-12',
            sums: [{ minor: 100_000n, currency: 'RUB' }],
            incomes: [
              row({ id: '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c30', receivedOn: '2025-12-10' }),
            ],
          },
        ],
      }),
    )
    const view = await render()
    vi.useRealTimers()
    const heads = view.findAll('.month-head').map((head) => head.text())
    // Whole sums as they would be typed, as everywhere in «Деньги» (MOL-81, В-1); the year only
    // where it is not this one (MOL-188, В-2 «а»).
    expect(heads[0]).toMatch(/^September₽99,615$/)
    expect(heads[1]).toMatch(/^August₽137,540 · \$500$/)
    expect(heads[2]).toMatch(/^December 2025₽1,000$/)
    expect(view.text()).toContain(en.income.source.freelance)
  })

  it('past New Year’s midnight with the screen in the hand, the year goes by the clock (А1)', async () => {
    const month = (month: string, receivedOn: string, id: string) => ({
      month,
      sums: [{ minor: 100_000n, currency: 'RUB' as const }],
      incomes: [row({ id, receivedOn })],
    })
    const december = month('2026-12', '2026-12-31', '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c31')
    const january = month('2027-01', '2027-01-01', '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c32')
    const captions = (view: VueWrapper): string[] =>
      view.findAll('.month-head .words').map((words) => words.text())
    const heads = (view: VueWrapper): string[] =>
      view.findAll('article .head .day').map((day) => day.text())
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 11, 31, 23, 50))
      incomes.mockResolvedValue(overview({ months: [december] }))
      recordIncome.mockResolvedValue({
        incomes: overview({ months: [january, december] }),
        created: true,
      })
      const view = await render()
      expect(captions(view)).toEqual(['December'])
      expect(heads(view)).toEqual(['Today'])

      // 00:05 of the 1st, never hidden: the screen's own day is still the 31st, the answer of the
      // write redraws it.
      vi.setSystemTime(new Date(2027, 0, 1, 0, 5))
      await recordThroughSheet(view)
      expect(incomes).toHaveBeenCalledTimes(1)
      expect(captions(view)).toEqual(['January', 'December 2026'])
      // The cards speak by the same day as their captions (Б1): never «December 2026» over «Today».
      expect(heads(view)).toEqual(['Today', 'Yesterday'])
    } finally {
      vi.useRealTimers()
    }
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
    // The verb and the day first — the day stands in the head, outside the button (handoff 03).
    expect(button.text()).toMatch(/^Amend income of .+:/)
    expect(button.text()).toContain(en.income.source.salary)
    expect(button.text()).toContain('₽99,615')
    expect(view.get('.amended').text()).toContain('amended')
    expect(view.get('.note-text').text()).toBe('Vikasa')
  })

  // In UTC, where Yerevan's midnight is the evening before (adversarial Ж): an income of 15
  // September reads «Sep 15», never «Sep 14».
  it('prints the day of the income as the day it was, west of Yerevan too', async () => {
    incomes.mockResolvedValue(overview())
    const view = await render()
    expect(view.get('article .day').text()).toBe('Sep 15')
    expect(view.get('button.body').text()).toMatch(/^Amend income of Sep 15:/)
  })

  it('heads the card of the phone’s today «Today», and the button still says the date (MOL-121)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T20:30:00Z'))
    try {
      incomes.mockResolvedValue(
        overview({
          months: [
            {
              month: '2026-09',
              sums: [{ minor: 9_961_500n, currency: 'RUB' }],
              incomes: [row({ receivedOn: '2026-09-28' })],
            },
          ],
        }),
      )
      const view = await render()
      expect(view.get('article .day').text()).toBe('Today')
      expect(view.get('button.body').text()).toMatch(/^Amend income of Sep 28:/)
      // Back in view after the phone's midnight, with nothing read again (adversarial Н).
      vi.setSystemTime(new Date('2026-09-29T00:20:00Z'))
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(incomes).toHaveBeenCalledTimes(1)
      expect(view.get('article .day').text()).toBe('Yesterday')
    } finally {
      vi.useRealTimers()
    }
  })

  it('an income without a note has no plate — the card is shorter (handoff 03)', async () => {
    incomes.mockResolvedValue(overview())
    const view = await render()
    expect(view.get('article').find('.plate').exists()).toBe(false)
  })
})

/** The skeleton top to bottom: `month` for a caption, a card as the lines of its plate. */
function skeletonShape(view: VueWrapper): (string | number)[] {
  return view.findAll('.skeleton-caption, .entry').map((part) => {
    if (!part.classes('entry')) return 'month'
    const plate = part.find('.plate')
    if (!plate.exists()) return 0
    return plate.classes('double') ? 2 : 1
  })
}

/** «Записать доход» in the strip over the tab bar — its words say why when it is not now (Ф-6). */
function recordButton(view: VueWrapper) {
  return view
    .findAll('.screen > .dock button')
    .find(
      (button) => button.text() === en.income.record || button.text() === en.income.record_offline,
    )
}

/** «Записать доход» → the sheet → 1 ₽ of «Другое» → «Сохранить». */
async function recordThroughSheet(view: VueWrapper): Promise<void> {
  await recordButton(view)?.trigger('click')
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
}

/** A tap on the row, the sheet risen, and «Сохранить исправление». */
async function amendThroughSheet(view: VueWrapper): Promise<void> {
  await view.get('button.body').trigger('click')
  await risen()
  sheetButton(en.income.sheet.save_amend).click()
  await flushPromises()
}

/** «Повторить» of the strip — the one on screen. */
async function retryStrip(view: VueWrapper): Promise<void> {
  await view
    .findAll('button')
    .find((button) => button.text() === en.state.retry)
    ?.trigger('click')
  await flushPromises()
}

describe('IncomesView: recording, amending and removing', () => {
  it('records through the sheet and lands the answer', async () => {
    incomes.mockResolvedValue(overview({ months: [] }))
    recordIncome.mockResolvedValue({ incomes: overview(), created: true })
    const view = await render()
    const record = recordButton(view)
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
    expect(view.text()).toContain('September')
  })

  it('a correction sent under the old name is said and the list read again (В-6)', async () => {
    incomes.mockResolvedValue(overview())
    const view = await render()
    recordIncome.mockRejectedValue(new ApiError(ERROR.CONFLICT))
    await recordThroughSheet(view)
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
    expect(bin.attributes('aria-label')).toBe('Remove income ₽99,615')
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

  // MOL-225, adversarial Р1-А2: «Bring back» at work said nothing and was drawn not now.
  it('«Bring back» on a slow line says «Bringing back…», at work, with the focus on it', async () => {
    incomes.mockResolvedValue(overview())
    removeIncome.mockResolvedValue(overview({ months: [] }))
    restoreIncome.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await view.get('button.remove').trigger('click')
    await risen()
    sheetButton(en.income.remove_sheet.confirm).click()
    await flushPromises()

    const restore = view.findAll('button').find((button) => button.text() === en.income.restore)
    if (!restore) throw new Error('no «Bring back»')
    expect(document.activeElement).toBe(restore.element)
    await restore.trigger('click')
    await flushPromises()
    expect(restore.find('.words > :not([aria-hidden])').text()).toBe(en.income.restoring)
    expect(restore.attributes('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(restore.element)
    // «Записать доход» is not now while the write is on its way, in its own words — the connection
    // is there (self-review №2): a tap would open the sheet over the write in the air.
    expect(recordButton(view)?.text()).toBe(en.income.record)
    expect(recordButton(view)?.attributes('aria-disabled')).toBe('true')
    await restore.trigger('click')
    expect(restoreIncome).toHaveBeenCalledOnce()
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
    // One line, with the time of the answer on screen (MOL-181); never red, nothing to retry, and
    // nothing of the recording — the button says it (Р-1).
    const strip = view.get('.status')
    expect(strip.text()).toContain(en.income.offline.strip.split('{when}')[0])
    expect(strip.text()).toMatch(/\d{1,2}:\d{2}/)
    expect(strip.text()).not.toContain(en.state.retry)
    expect(strip.text()).not.toContain(en.income.record_offline)
    expect(view.findAllComponents(StatusStrip)).toHaveLength(1)
    expect(view.get('button.remove').attributes('disabled')).toBeDefined()
    expect(view.get('button.body').attributes('disabled')).toBeDefined()
    // «Записать доход» stays in the strip, not now, saying why, and a tap on it opens nothing (Ф-6).
    const record = recordButton(view)
    expect(record?.text()).toBe(en.income.record_offline)
    expect(record?.attributes('aria-disabled')).toBe('true')
    await record?.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()

    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(recordButton(view)?.text()).toBe(en.income.record)
    expect(recordButton(view)?.attributes('aria-disabled')).toBeUndefined()
  })

  it('offline on the empty screen: the strip stays, not now, over the quiet circle', async () => {
    incomes.mockResolvedValue(overview({ months: [] }))
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(view.text()).toContain(en.income.empty.title)
    expect(recordButton(view)?.text()).toBe(en.income.record_offline)
    expect(recordButton(view)?.attributes('aria-disabled')).toBe('true')
  })

  it('«Record income» is named by its words in the strip, with incomes and empty (Ф-28)', async () => {
    incomes.mockResolvedValue(overview())
    const full = await render()
    const record = recordButton(full)
    expect(record?.text()).toBe(en.income.record)
    expect(record?.attributes('aria-label')).toBeUndefined()
    expect(record?.attributes('aria-disabled')).toBeUndefined()
    // The frame's strip, under the list — the room for it is kept at the end of the content.
    expect(full.find('.dock-room').exists()).toBe(true)
    expect(full.findComponent({ name: 'FloatingDock' }).exists()).toBe(false)

    incomes.mockResolvedValue(overview({ months: [] }))
    const empty = await render()
    expect(empty.text()).toContain(en.income.empty.title)
    expect(recordButton(empty)?.text()).toBe(en.income.record)
  })
})

describe('IncomesView: the connection in one line (MOL-181, Ф-14)', () => {
  /** The list as the server holds it after the write: the income at its next version. */
  const amended = (): IncomesResponse =>
    overview({ months: [{ month: '2026-09', sums: [], incomes: [row({ revision: 2 })] }] })

  it('no strip while the list is the server’s', async () => {
    incomes.mockResolvedValue(overview())
    const view = await render()
    expect(view.findComponent(StatusStrip).exists()).toBe(false)
  })

  it('a night offline: the answer of 23:40 is «yesterday» once the app is looked at again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 9, 14, 23, 40))
      incomes.mockResolvedValue(overview())
      const view = await render()
      online(false)
      window.dispatchEvent(new Event('offline'))
      await flushPromises()
      expect(view.get('.status').text()).toContain('today, 11:40 PM')

      // Unlocked at 9:00 with no connection still: nothing is read, the strip is drawn again.
      vi.setSystemTime(new Date(2026, 9, 15, 9, 0))
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(view.get('.status').text()).toContain('yesterday, 11:40 PM')
      expect(incomes).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('offline on the empty screen: the strip over the quiet circle (incomes-offline-empty)', async () => {
    incomes.mockResolvedValue(overview({ months: [] }))
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(view.get('.status').text()).toContain(en.income.offline.strip.split('{when}')[0])
    expect(view.text()).toContain(en.income.empty.title)
  })

  it('the list read again after a conflict did not come: «the server did not answer», and «Try again»', async () => {
    incomes
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockResolvedValue(overview())
    recordIncome.mockRejectedValue(new ApiError(ERROR.CONFLICT))
    const view = await render()

    await recordThroughSheet(view)
    const strip = view.get('.status')
    expect(strip.text()).toContain(en.income.error_strip.split('{when}')[0])
    expect(strip.text()).not.toContain('{when}')
    // The list is the one from before the write: nothing says it shows the income (MOL-187, №1).
    expect(view.text()).toContain(en.income.conflict_stale)
    expect(view.text()).not.toContain(en.income.conflict)
    // One «Try again»: the strip over the tab bar holds «Record income» (К-5).
    const retries = view.findAll('button').filter((button) => button.text() === en.state.retry)
    expect(retries).toHaveLength(1)
    expect(recordButton(view)?.text()).toBe(en.income.record)

    // Failed again: the same strip, a new attempt said again (C1).
    const before = view.getComponent(StatusStrip).props('attempt') as number
    await retryStrip(view)
    expect(view.get('.status').text()).toContain(en.income.error_strip.split('{when}')[0])
    expect(view.getComponent(StatusStrip).props('attempt')).toBe(before + 1)

    await retryStrip(view)
    expect(view.find('.status').exists()).toBe(false)
    expect(incomes).toHaveBeenCalledTimes(4)
    // Read at last: now the list does show it.
    expect(view.text()).toContain(en.income.conflict)
    expect(view.text()).not.toContain(en.income.conflict_stale)
  })

  it('an amendment over a moved-on version or a vanished income, read again and not answered', async () => {
    for (const [code, stale, shown] of [
      [ERROR.CONFLICT, en.income.amend_conflict_stale, en.income.amend_conflict],
      [ERROR.NOT_FOUND, en.income.vanished_stale, en.income.vanished],
    ] as const) {
      incomes
        .mockReset()
        .mockResolvedValueOnce(overview())
        .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
        .mockResolvedValue(amended())
      amendIncome.mockReset().mockRejectedValueOnce(new ApiError(code))
      const view = await render()
      await amendThroughSheet(view)
      expect(view.get('.status').text()).toContain(en.income.error_strip.split('{when}')[0])
      expect(view.text()).toContain(stale)
      expect(view.text()).not.toContain(shown)

      await retryStrip(view)
      expect(view.text()).toContain(shown)
      expect(view.text()).not.toContain(stale)
      view.unmount()
      views.splice(views.indexOf(view), 1)
      document.body.innerHTML = ''
    }
  })

  it('a late «Bring back» read again and not answered: the strip says the list may be old', async () => {
    incomes
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockResolvedValue(overview())
    removeIncome.mockResolvedValue(overview({ months: [] }))
    restoreIncome.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const view = await render()
    await view.get('button.remove').trigger('click')
    await risen()
    sheetButton(en.income.remove_sheet.confirm).click()
    await flushPromises()
    await view
      .findAll('button')
      .find((button) => button.text() === en.income.restore)
      ?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.income.restore_gone)
    expect(view.get('.status').text()).toContain(en.income.error_strip.split('{when}')[0])
  })

  it('the same read lost with the connection: offline, not «the server», and no «here it is now» (Б1)', async () => {
    // The connection goes the moment the server's answer to the write comes.
    const lostOffline = (): Promise<never> => {
      online(false)
      window.dispatchEvent(new Event('offline'))
      return Promise.reject(new ApiError(ERROR.INTERNAL, 'network', false))
    }
    for (const [write, stale, shown] of [
      ['record', en.income.conflict_stale, en.income.conflict],
      [ERROR.CONFLICT, en.income.amend_conflict_stale, en.income.amend_conflict],
      [ERROR.NOT_FOUND, en.income.vanished_stale, en.income.vanished],
    ] as const) {
      online(true)
      incomes
        .mockReset()
        .mockResolvedValueOnce(overview())
        .mockImplementationOnce(lostOffline)
        .mockResolvedValue(amended())
      recordIncome.mockReset().mockRejectedValue(new ApiError(ERROR.CONFLICT))
      amendIncome.mockReset()
      const view = await render()
      if (write === 'record') await recordThroughSheet(view)
      else {
        amendIncome.mockRejectedValueOnce(new ApiError(write))
        await amendThroughSheet(view)
      }
      expect(view.get('.status').text()).toContain(en.income.offline.strip.split('{when}')[0])
      expect(view.text()).not.toContain(en.state.retry)
      expect(view.text()).toContain(stale)
      expect(view.text()).not.toContain(shown)

      // Back online, the list is read by itself, and now it is what the words say.
      online(true)
      window.dispatchEvent(new Event('online'))
      await flushPromises()
      expect(incomes).toHaveBeenCalledTimes(3)
      expect(view.text()).toContain(shown)
      expect(view.text()).not.toContain(stale)
      view.unmount()
      views.splice(views.indexOf(view), 1)
      document.body.innerHTML = ''
    }
  })

  it('another owner starts with no answer time and no failed reads of the last one', async () => {
    incomes
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    recordIncome.mockRejectedValue(new ApiError(ERROR.CONFLICT))
    const view = await render()
    await recordThroughSheet(view)
    expect(view.getComponent(StatusStrip).props('attempt')).toBe(1)

    useActorStore().id = 'aaaaaaaa-0000-4000-8000-000000000009'
    await flushPromises()
    expect(view.findComponent(StatusStrip).exists()).toBe(false)
    expect(view.text()).not.toContain(en.income.conflict_stale)

    // The new owner's first failed read is the first, not the second.
    await recordThroughSheet(view)
    expect(view.getComponent(StatusStrip).props('attempt')).toBe(1)
  })
})
