import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseRate, yerevanMidnight } from '@molvia/model'
import type {
  ExchangeAmendBody,
  ExchangeBody,
  ExchangeView as Row,
  ExchangesResponse,
  RatePreference,
} from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import ExchangeView from './ExchangeView.vue'

const exchanges = vi.fn<() => Promise<ExchangesResponse>>()
const chooseRatePreference = vi.fn<(preference: RatePreference) => Promise<ExchangesResponse>>()
const removeExchange = vi.fn<(id: string) => Promise<ExchangesResponse>>()
const recordExchange =
  vi.fn<(body: ExchangeBody) => Promise<{ exchanges: ExchangesResponse; created: boolean }>>()
const restoreExchange = vi.fn<(id: string) => Promise<ExchangesResponse>>()
const amendExchange = vi.fn<(id: string, body: ExchangeAmendBody) => Promise<ExchangesResponse>>()
vi.mock('@/api', () => ({
  api: {
    exchanges: () => exchanges(),
    chooseRatePreference: (preference: RatePreference) => chooseRatePreference(preference),
    removeExchange: (id: string) => removeExchange(id),
    recordExchange: (body: ExchangeBody) => recordExchange(body),
    restoreExchange: (id: string) => restoreExchange(id),
    amendExchange: (id: string, body: ExchangeAmendBody) => amendExchange(id, body),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

const rate = (value: string, day: string, source: 'personal' | 'official' = 'personal') => ({
  base: 'RUB' as const,
  quote: 'AMD' as const,
  scaled: parseRate(value),
  source,
  asOf: yerevanMidnight(day),
})

function row(patch: Partial<Row> = {}): Row {
  return {
    id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
    exchangedOn: '2026-09-15',
    given: { minor: 2_000_000n, currency: 'RUB' },
    received: { minor: 9_500_000n, currency: 'AMD' },
    heldBefore: null,
    note: null,
    revision: 1,
    amendedAt: null,
    history: [],
    rate: rate('4.75', '2026-09-15'),
    official: {
      rate: rate('4.3123', '2026-09-15', 'official'),
      provider: 'cba',
      difference: { minor: 875_400n, currency: 'AMD' },
    },
    officialDoubtful: false,
    ...patch,
  }
}

function overview(patch: Partial<ExchangesResponse> = {}): ExchangesResponse {
  return {
    preference: 'personal',
    pair: { base: 'RUB', quote: 'AMD' },
    wallet: { rate: rate('4.791667', '2026-09-15'), basis: 'weighted', estimated: false },
    costs: [],
    heldEstimates: [],
    baseSince: null,
    walletUnknown: null,
    exchanges: [row()],
    ...patch,
  }
}

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = ACTOR
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/exchange')
  const view = mount(ExchangeView, {
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
  exchanges.mockReset()
  chooseRatePreference.mockReset()
  removeExchange.mockReset()
  recordExchange.mockReset()
  restoreExchange.mockReset()
  amendExchange.mockReset()
  online(true)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

/** Opens «Удалить обмен?» from the bin and waits for the sheet to rise — until then it takes no tap. */
async function askToRemove(view: VueWrapper): Promise<void> {
  await view.get('button.remove').trigger('click')
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function confirmButton() {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (button) => button.textContent.trim() === en.exchange.remove_sheet.confirm,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error('no «Delete» in the sheet')
  return found
}

/** «Записать обмен» → the sheet → 20 000 ₽ → 95 000 ֏ → «Сохранить». */
async function recordThroughSheet(view: VueWrapper): Promise<void> {
  const record = view.findAll('button').find((button) => button.text() === en.exchange.record)
  await record?.trigger('click')
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  const sheet = document.querySelector('dialog[open]')
  const inputs = sheet?.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]') ?? []
  for (const [index, value] of ['20000', '95000'].entries()) {
    const input = inputs[index]
    if (!input) throw new Error('no amount field')
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  await flushPromises()
  const save = [...(sheet?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent.trim() === en.exchange.sheet.save,
  )
  save?.click()
  await flushPromises()
}

describe('ExchangeView: the four states', () => {
  it('loads with a skeleton, nothing invented', async () => {
    exchanges.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.text()).not.toContain(en.exchange.my_rate)
  })

  it('a failed read is red with «Try again», and trying again reads again', async () => {
    exchanges.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValue(overview())
    const view = await render()
    expect(view.text()).toContain(en.exchange.load_error.title)

    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.exchange.my_rate)
  })

  it('offline is never red and offers no button — the screen comes back by itself', async () => {
    online(false)
    exchanges.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.exchange.offline.body)
    expect(view.text()).not.toContain(en.state.retry)
  })

  it('without exchanges offers to record one, and says the trips keep the central bank', async () => {
    exchanges.mockResolvedValue(overview({ wallet: null, exchanges: [] }))
    const view = await render()
    expect(view.text()).toContain(en.exchange.empty.title)
    expect(view.text()).toContain(en.exchange.empty.body)
    expect(view.text()).toContain(en.exchange.record)
  })
})

describe('ExchangeView: the rate and the list', () => {
  it('prints the wallet with how it was worked out and since when', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    expect(view.get('.figure').text()).toContain('4.79')
    expect(view.text()).toContain('average of what is left')
  })

  it('says «by the last exchange» when what was held is unknown', async () => {
    exchanges.mockResolvedValue(
      overview({ wallet: { rate: rate('4.75', '2026-09-15'), basis: 'last', estimated: false } }),
    )
    const view = await render()
    expect(view.text()).toContain('by the last exchange')
  })

  it('says when part of the rate was priced by the bank, and prints each currency of a chain (MOL-42)', async () => {
    exchanges.mockResolvedValue(
      overview({
        wallet: { rate: rate('4.060187', '2026-09-13'), basis: 'last', estimated: true },
        costs: [
          {
            rate: {
              base: 'USD',
              quote: 'RUB',
              scaled: parseRate('89.035302'),
              source: 'personal',
              asOf: yerevanMidnight('2026-08-31'),
            },
            basis: 'last',
            estimated: false,
          },
        ],
      }),
    )
    const view = await render()
    expect(view.text()).toContain(en.exchange.estimated)
    const [line] = view.findAll('.costs li')
    expect(line?.text()).toContain('$: 89.04 ₽/$')
    expect(line?.text()).toContain('by the last exchange')
    expect(line?.text()).not.toContain('Central Bank')
  })

  it('says why the rate is unknown, not «no exchanges yet» above a list of them (С-4)', async () => {
    exchanges.mockResolvedValue(
      overview({ wallet: null, walletUnknown: { exchangedOn: '2026-08-25', given: 'USD' } }),
    )
    const view = await render()
    expect(view.text()).toContain('Rate unknown: the $ → ֏ exchange of')
    expect(view.text()).not.toContain('exchanges yet')
  })

  it('names the day the currency of conversion changed, and says nothing when it never did', async () => {
    exchanges.mockResolvedValue(overview({ wallet: null, baseSince: '2026-09-18' }))
    const view = await render()
    expect(view.text()).toContain('Counting in ₽ since')
    expect(view.find('.costs').exists()).toBe(false)

    exchanges.mockResolvedValue(overview())
    const plain = await render()
    expect(plain.text()).not.toContain('Counting in')
    expect(plain.text()).not.toContain(en.exchange.estimated)
  })

  it('compares with the bank in words — more, less, or nothing to compare with', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row(),
          row({
            id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e',
            official: {
              rate: rate('5', '2026-09-10', 'official'),
              provider: 'cba',
              difference: { minor: -500_000n, currency: 'AMD' },
            },
          }),
          row({ id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5f', official: null }),
        ],
      }),
    )
    const view = await render()
    const rows = view.findAll('.row')
    expect(rows[0]?.text()).toMatch(/8,754\.00.*more than the central bank/)
    expect(rows[1]?.text()).toMatch(/5,000\.00.*less than the central bank/)
    expect(rows[2]?.text()).toContain(en.exchange.row_no_official)
    expect(view.text()).not.toMatch(/commission/i)
  })

  it('says the bank’s rate of that day is in doubt when it jumped with nothing before it (С-5)', async () => {
    exchanges.mockResolvedValue(
      overview({ exchanges: [row({ official: null, officialDoubtful: true })] }),
    )
    const view = await render()
    expect(view.get('.row').text()).toContain(en.exchange.row_doubtful)
  })

  it('names an open source when the bank of that day was not the central bank', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            official: {
              rate: rate('4.31', '2026-09-15', 'official'),
              provider: 'cbr',
              difference: { minor: 100n, currency: 'AMD' },
            },
          }),
        ],
      }),
    )
    const view = await render()
    const text = view.get('.row').text()
    // Named instead of the central bank, never beside it (С-6).
    expect(text).toContain(`than the ${en.trip.rate.source_cbr} rate`)
    expect(text).not.toContain('central bank')
  })

  it('without a pair says there is nothing to convert, and offers no preference', async () => {
    exchanges.mockResolvedValue(overview({ pair: null, wallet: null }))
    const view = await render()
    expect(view.text()).toContain(en.settings.same_currencies)
    expect(view.find('fieldset').exists()).toBe(false)
  })

  it('switches the preference through the API and shows what the server answered', async () => {
    exchanges.mockResolvedValue(overview())
    chooseRatePreference.mockResolvedValue(overview({ preference: 'official' }))
    const view = await render()

    await view.get('input[value="official"]').setValue(true)
    await flushPromises()
    expect(chooseRatePreference).toHaveBeenCalledWith('official')
    expect((view.get('input[value="official"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('a refused preference goes back to what the server holds — for the radio too (Б3)', async () => {
    exchanges.mockResolvedValue(overview())
    chooseRatePreference.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()

    await view.get('input[value="official"]').setValue(true)
    await flushPromises()
    expect((view.get('input[value="personal"]').element as HTMLInputElement).checked).toBe(true)
    expect((view.get('input[value="official"]').element as HTMLInputElement).checked).toBe(false)
    expect(view.get('.segment.on').text()).toBe(en.exchange.preference_personal)
  })

  it('the preference cannot be touched without a connection or while one is on its way', async () => {
    exchanges.mockResolvedValue(overview())
    chooseRatePreference.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await view.get('input[value="official"]').setValue(true)
    await flushPromises()
    expect(view.get('fieldset').attributes('disabled')).toBeDefined()
  })

  it('the bin asks first, naming the exchange, and removes nothing until confirmed (В-5)', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()

    const remove = view.get('button.remove')
    expect(remove.attributes('aria-label')).toMatch(/Delete the exchange .*20,000\.00.*95,000\.00/)
    await askToRemove(view)
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain(en.exchange.remove_sheet.title)
    expect(sheet?.textContent).toMatch(/20,000\.00.*95,000\.00/)
    expect(removeExchange).not.toHaveBeenCalled()
  })

  it('removes when confirmed, puts the focus on «Bring back», which brings the same row back', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    restoreExchange.mockResolvedValue(overview())
    const view = await render()

    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    expect(removeExchange).toHaveBeenCalledWith(row().id)
    expect(view.text()).toContain('Exchange deleted')
    // The bin went with its row: the focus lands one swipe from undoing it (Н-1).
    expect(document.activeElement?.textContent.trim()).toBe(en.exchange.restore)

    const restore = view.findAll('button').find((button) => button.text() === en.exchange.restore)
    await restore?.trigger('click')
    await flushPromises()
    expect(restoreExchange).toHaveBeenCalledWith(row().id)
    expect(recordExchange).not.toHaveBeenCalled()
    expect(view.text()).not.toContain('Exchange deleted')
  })

  it('«Bring back» after the removal became final says so, and reads the list again (Д1)', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    restoreExchange.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()

    const restore = view.findAll('button').find((button) => button.text() === en.exchange.restore)
    await restore?.trigger('click')
    await flushPromises()
    expect(view.text()).toContain(en.exchange.restore_gone)
    expect(view.text()).not.toContain(en.exchange.failed)
    expect(view.text()).not.toContain(en.exchange.restore)
    expect(exchanges).toHaveBeenCalledTimes(2)
  })

  it('once back, the focus goes to «Record an exchange» (Т-3)', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    restoreExchange.mockResolvedValue(overview())
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    const restore = view.findAll('button').find((button) => button.text() === en.exchange.restore)
    await restore?.trigger('click')
    await flushPromises()
    expect(document.activeElement?.textContent.trim()).toBe(en.exchange.record)
  })

  it('a new exchange that never reached the server keeps «Bring back» (Е1)', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [row()] }))
    recordExchange.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()

    await recordThroughSheet(view)
    expect(recordExchange).toHaveBeenCalledTimes(1)
    expect(view.text()).toContain(en.exchange.restore)
  })

  it('a second removal that never reached the server keeps the first one undoable (Е2)', async () => {
    const other = row({ id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e' })
    exchanges.mockResolvedValue(overview({ exchanges: [row(), other] }))
    removeExchange
      .mockResolvedValueOnce(overview({ exchanges: [other] }))
      .mockRejectedValueOnce(new TypeError('network'))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    expect(view.text()).toContain('Exchange deleted')

    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    expect(view.text()).toContain(en.exchange.failed)
    expect(view.text()).toContain(en.exchange.restore)
  })

  it('a preference that never reached the server keeps «Bring back» (Д4)', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [row()] }))
    chooseRatePreference.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()

    await view.get('input[value="official"]').setValue(true)
    await flushPromises()
    expect(view.text()).toContain(en.exchange.restore)
  })

  it('another owner gets none of the last one’s strips (Г1)', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    expect(view.text()).toContain('Exchange deleted')

    useActorStore().id = 'aaaaaaaa-0000-4000-8000-000000000009'
    await flushPromises()
    expect(view.text()).not.toContain('Exchange deleted')
    expect(view.text()).not.toContain(en.exchange.restore)
  })

  it('a correction sent under the old name closes the sheet and says to remove and re-enter (В-6)', async () => {
    exchanges.mockResolvedValue(overview())
    recordExchange.mockRejectedValue(new ApiError(ERROR.CONFLICT))
    const view = await render()

    await recordThroughSheet(view)

    expect(view.text()).toContain(en.exchange.conflict)
    expect(exchanges).toHaveBeenCalledTimes(2)
    expect(document.querySelector('dialog[open]')).toBeNull()
  })

  it('a failure said once goes when the next write succeeds — a new exchange included (Г2)', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    recordExchange.mockResolvedValue({ exchanges: overview(), created: true })
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    expect(view.text()).toContain(en.exchange.failed)

    await recordThroughSheet(view)
    expect(recordExchange).toHaveBeenCalledTimes(1)
    expect(view.text()).not.toContain(en.exchange.failed)
  })

  it('a failed removal is said once and offers nothing to bring back', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()

    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    expect(view.get('[role="alert"]').text()).toBe(en.exchange.failed)
    expect(view.text()).not.toContain(en.exchange.restore)
  })

  it('without a connection shows what it has, and writes nothing', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    expect(view.text()).toContain(en.exchange.offline.strip)
    expect(view.get('button.remove').attributes('disabled')).toBeDefined()
  })
})

describe('ExchangeView: amending an exchange (MOL-42, В-3)', () => {
  /** A tap on the row, and the sheet risen — until then it takes no tap. */
  async function openRow(view: VueWrapper): Promise<void> {
    await view.get('button.body').trigger('click')
    await flushPromises()
    clock += 1000
    await new Promise((resolve) => setTimeout(resolve, 5))
  }

  async function saveAmendment(): Promise<void> {
    const save = [...document.querySelectorAll('dialog[open] button')].find(
      (button) => button.textContent.trim() === en.exchange.sheet.save_amend,
    )
    if (!(save instanceof HTMLButtonElement)) throw new Error('no «Save the amendment»')
    save.click()
    await flushPromises()
  }

  it('marks an amended row and shows its note', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [row({ amendedAt: new Date('2026-09-25T09:00:00.000Z'), note: 'airport' })],
      }),
    )
    const view = await render()
    expect(view.get('.amended').text()).toContain('amended')
    expect(view.get('.note').text()).toBe('airport')
  })

  it('opens the row in the sheet for an amendment, and lands the answer', async () => {
    exchanges.mockResolvedValue(overview())
    amendExchange.mockResolvedValue(overview({ exchanges: [row({ revision: 2 })] }))
    const view = await render()
    await openRow(view)
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.exchange.sheet.title_amend,
    )
    await saveAmendment()
    expect(amendExchange).toHaveBeenCalledWith(row().id, expect.objectContaining({ revision: 1 }))
  })

  it('an amendment made over a version that moved on says so, reads the list again and keeps the sheet', async () => {
    exchanges
      .mockResolvedValueOnce(overview())
      .mockResolvedValue(overview({ exchanges: [row({ revision: 2 })] }))
    amendExchange.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
    const view = await render()
    await openRow(view)
    await saveAmendment()
    expect(view.text()).toContain(en.exchange.amend_conflict)
    expect(exchanges).toHaveBeenCalledTimes(2)
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.exchange.sheet.amend_conflict,
    )
    // The second «Save» goes over the version the server holds now.
    amendExchange.mockResolvedValue(overview())
    await saveAmendment()
    expect(amendExchange.mock.calls.at(-1)?.[1]).toMatchObject({ revision: 2 })
  })

  it('the row is named by its words, the rate and the comparison included (С-3)', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    const button = view.get('button.body')
    expect(button.attributes('aria-label')).toBeUndefined()
    expect(button.text()).toContain(en.exchange.edit)
    expect(button.text()).toContain('more than the central bank')
  })

  it('an exchange removed elsewhere is said to be gone, not «check the connection»', async () => {
    exchanges.mockResolvedValue(overview())
    amendExchange.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    const view = await render()
    await openRow(view)
    await saveAmendment()
    expect(view.text()).toContain(en.exchange.vanished)
    expect(view.text()).not.toContain(en.exchange.failed)
  })
})
