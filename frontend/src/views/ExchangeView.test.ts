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
    givenAccountId: null,
    receivedAccountId: null,
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
    receipts: [],
    ...patch,
  }
}

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = ACTOR
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/exchange')
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

/** «Записать обмен»: the floating «Обмен» named in full, or the empty state's own button. */
function recordButton(view: VueWrapper) {
  return view
    .findAll('button')
    .find(
      (button) =>
        button.attributes('aria-label') === en.exchange.record ||
        button.text() === en.exchange.record,
    )
}

/** «Записать обмен» → the sheet → 20 000 ₽ → 95 000 ֏ → «Сохранить». */
async function recordThroughSheet(view: VueWrapper): Promise<void> {
  await recordButton(view)?.trigger('click')
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

  it('incomes alone make a rate: the card is drawn — the figure, why, the switch — and no list (Д1)', async () => {
    // Drams that came in with no exchange: the wallet a trip takes (MOL-66, adversarial Д1).
    exchanges.mockResolvedValue(
      overview({
        exchanges: [],
        wallet: { rate: rate('4.3', '2026-09-05'), basis: 'income', estimated: true },
      }),
    )
    const view = await render()
    expect(view.text()).not.toContain(en.exchange.empty.title)
    expect(view.get('.figure').text()).toContain('4.3')
    expect(view.text()).toContain('by the last income')
    expect(view.text()).toContain(en.exchange.preference_legend)
    expect(recordButton(view)?.text()).toBe(en.exchange.fab)
    expect(view.text()).not.toContain(en.exchange.list_title)
  })

  it('incomes that lost the rate, or priced another currency, draw the card too', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [],
        wallet: null,
        walletUnknown: { on: '2026-09-20', given: null, reason: 'noRate' },
      }),
    )
    const lost = await render()
    expect(lost.text()).toContain('Rate unknown: the ֏ income of')
    lost.unmount()

    exchanges.mockResolvedValue(
      overview({
        exchanges: [],
        wallet: null,
        costs: [
          {
            rate: { ...rate('80', '2026-09-20'), base: 'USD', quote: 'RUB' },
            basis: 'income',
            estimated: true,
          },
        ],
      }),
    )
    const dollars = await render()
    expect(dollars.text()).not.toContain(en.exchange.empty.title)
    expect(dollars.get('.costs').text()).toContain('by the last income')
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
    // The rate names both currencies; a «$:» in front of it said one of them twice (MOL-81).
    expect(line?.text()).toMatch(/^89\.04 ₽\/\$ · /)
    expect(line?.text()).toContain('by the last exchange')
    expect(line?.text()).not.toContain('Central Bank')
  })

  it('says why the rate is unknown, not «no exchanges yet» above a list of them (С-4)', async () => {
    exchanges.mockResolvedValue(
      overview({
        wallet: null,
        walletUnknown: { on: '2026-08-25', given: 'USD', reason: 'noRate' },
      }),
    )
    const view = await render()
    expect(view.text()).toContain('Rate unknown: the $ → ֏ exchange of')
    expect(view.text()).not.toContain('exchanges yet')
  })

  it('names an income the rate was lost on, and the income a rate was taken from (MOL-66)', async () => {
    exchanges.mockResolvedValue(
      overview({
        wallet: null,
        walletUnknown: { on: '2026-09-20', given: null, reason: 'noRate' },
      }),
    )
    const lost = await render()
    expect(lost.text()).toContain('Rate unknown: the ֏ income of')
    lost.unmount()

    exchanges.mockResolvedValue(
      overview({ wallet: { rate: rate('4.3', '2026-09-20'), basis: 'income', estimated: true } }),
    )
    const taken = await render()
    expect(taken.text()).toContain('by the last income')
    expect(taken.text()).toContain('days of exchanges and incomes')
  })

  it('names the old reckoning as the reason, not a missing bank rate (Н1)', async () => {
    exchanges.mockResolvedValue(
      overview({
        wallet: null,
        baseSince: '2026-09-25',
        walletUnknown: { on: '2026-09-05', given: 'EUR', reason: 'oldReckoning' },
      }),
    )
    const view = await render()
    expect(view.text()).toContain('Rate unknown: the ֏ bought on')
    expect(view.text()).toContain('with € have no price in ₽')
    expect(view.text()).not.toContain('exchanges yet')
    expect(view.text()).not.toContain('Central Bank of Armenia rate for that day')
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
    const cards = view.findAll('article')
    // Whole amounts as they would be typed, as everywhere in «Деньги» (MOL-81, В-1).
    expect(cards[0]?.get('.difference').text()).toBe('֏8,754 more than the central bank')
    expect(cards[1]?.get('.difference').text()).toBe('֏5,000 less than the central bank')
    // Nothing to compare with is one line in place of three: no bank's rate and no difference.
    expect(cards[2]?.get('.missing').text()).toBe(en.exchange.card_no_official)
    expect(cards[2]?.find('.difference').exists()).toBe(false)
    expect(cards[2]?.findAll('.plate .line')).toHaveLength(1)
    expect(view.text()).not.toMatch(/commission/i)
  })

  it('says the bank’s rate of that day is in doubt when it jumped with nothing before it (С-5)', async () => {
    exchanges.mockResolvedValue(
      overview({ exchanges: [row({ official: null, officialDoubtful: true })] }),
    )
    const view = await render()
    expect(view.get('article .missing').text()).toBe(en.exchange.card_doubtful)
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
    const text = view.get('article').text()
    // Named instead of the central bank, never beside it (С-6) — in the label and the difference.
    expect(view.get('article .plate .line + .line .label').text()).toMatch(
      new RegExp(`^${en.trip.rate.source_cbr} on `),
    )
    expect(text).toContain(`than the ${en.trip.rate.source_cbr} rate`)
    expect(text).not.toMatch(/central bank/i)
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
    expect(remove.attributes('aria-label')).toMatch(/^Delete the exchange ₽20,000 → ֏95,000$/)
    await askToRemove(view)
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain(en.exchange.remove_sheet.title)
    expect(sheet?.textContent).toContain('₽20,000 → ֏95,000')
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
    expect(document.activeElement?.getAttribute('aria-label')).toBe(en.exchange.record)
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
    // «Обмен» floats on, inactive rather than gone, and a tap on it opens nothing (handoff 02).
    const record = recordButton(view)
    expect(record?.attributes('aria-disabled')).toBe('true')
    await record?.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
  })

  it('«Обмен» floats, named in full; the empty screen keeps its own button instead (handoff 02)', async () => {
    exchanges.mockResolvedValue(overview())
    const full = await render()
    const floating = full.get(`button[aria-label="${en.exchange.record}"]`)
    expect(floating.text()).toBe(en.exchange.fab)
    expect(floating.attributes('aria-disabled')).toBeUndefined()

    exchanges.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    const empty = await render()
    expect(empty.text()).toContain(en.exchange.empty.title)
    expect(empty.find(`button[aria-label="${en.exchange.record}"]`).exists()).toBe(false)
    expect(recordButton(empty)?.text()).toBe(en.exchange.record)
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
    // The verb and the day first — the day stands in the head, outside the button (handoff 02).
    expect(button.text()).toMatch(/^Edit the exchange of .+:/)
    for (const words of [
      en.exchange.card_given,
      en.exchange.card_received,
      en.exchange.card_rate,
      'more than the central bank',
    ]) {
      expect(button.text()).toContain(words)
    }
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
