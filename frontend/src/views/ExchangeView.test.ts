import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Router } from 'vue-router'
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
import StatusStrip from '@/components/StatusStrip.vue'
import UndoStrip from '@/components/UndoStrip.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'

/** A text of the dictionary with the bank of a pair without the lari named in it (MOL-110). */
const cba = (text: string): string => text.replace('{bank}', en.exchange.card_source_cba)
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
    channel: null,
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
    market: null,
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
    marketToday: [],
    losses: null,
    rateCharts: null,
    ...patch,
  }
}

const views: VueWrapper[] = []
let router: Router
async function render(path = '/money/exchange'): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = ACTOR
  router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
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
  vi.useRealTimers()
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

/** A sheet risen — until then it takes no tap. */
async function risen(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

/** A button of the sheet on top by its words. */
function sheetButton(words: string): HTMLButtonElement {
  const sheets = document.querySelectorAll('dialog[open]')
  const found = [...(sheets[sheets.length - 1]?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent.trim() === words,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no «${words}» in the sheet`)
  return found
}

/** The first card — the way into its amendment — and the sheet risen. */
async function openCard(view: VueWrapper): Promise<void> {
  await view.get('.cards button.body').trigger('click')
  await risen()
}

/**
 * «Удалить обмен?»: the card, «Удалить обмен» in the sheet of the amendment, and the question risen
 * over it (MOL-189, Ф-34).
 */
async function askToRemove(view: VueWrapper): Promise<void> {
  await openCard(view)
  sheetButton(en.exchange.sheet.remove).click()
  await risen()
}

/**
 * «‹» on the question, then × on the amendment — both sheets put away by hand while the removal is on
 * its way. The memory history sends no `popstate`, and `stepBack` holds the next step until one.
 */
async function putBothAway(): Promise<void> {
  for (const label of [en.nav.back_label, en.sheet.close]) {
    const sheets = document.querySelectorAll('dialog[open]')
    sheets[sheets.length - 1]
      ?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?.click()
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await risen()
  }
}

function confirmButton() {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (button) => button.textContent.trim() === en.exchange.remove_sheet.confirm,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error('no «Delete» in the sheet')
  return found
}

/** «Записать обмен» in the strip over the tab bar — its words say why when it is not now (Ф-6). */
function recordButton(view: VueWrapper) {
  return view
    .findAll('.screen > .dock button')
    .find(
      (button) =>
        button.text() === en.exchange.record || button.text() === en.exchange.record_offline,
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
    // The line of the rate stands in the skeleton too, between the two figures (MOL-178).
    const parts = view.findAll('.skeleton-figure, .ghost-chart').map((part) => part.classes())
    expect(parts.map((classes) => classes.includes('ghost-chart'))).toEqual([false, true, false])
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
    expect(recordButton(view)?.text()).toBe(en.exchange.record)
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
    expect(view.text()).toContain(cba(en.exchange.empty.body))
    // The strip's, not a button of the empty state (Ф-16).
    expect(recordButton(view)?.text()).toBe(en.exchange.record)
    expect(view.get('.state').findAll('button')).toHaveLength(0)
  })

  it('no «Record an exchange» while there is no answer: loading, an error, offline with nothing', async () => {
    exchanges.mockReturnValue(new Promise(() => undefined))
    const loading = await render()
    expect(recordButton(loading)).toBeUndefined()

    exchanges.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const failed = await render()
    expect(failed.text()).toContain(en.exchange.load_error.title)
    expect(recordButton(failed)).toBeUndefined()

    online(false)
    exchanges.mockRejectedValue(new TypeError('network'))
    const offline = await render()
    expect(offline.text()).toContain(en.exchange.offline.body)
    expect(recordButton(offline)).toBeUndefined()
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
    expect(view.text()).toContain(cba(en.exchange.estimated))
    const [line] = view.findAll('.costs li')
    // The rate names both currencies; a «$:» in front of it said one of them twice (MOL-81).
    expect(line?.text()).toMatch(/^89\.04 ₽\/\$ · /)
    expect(line?.text()).toContain('by the last exchange')
    expect(line?.text()).not.toContain('Central Bank')
  })

  it('a priced spending currency with no wallet says the rate is out of a trip’s reach (В′)', async () => {
    const receipt = { id: row().id, currency: 'AMD' as const, on: '2026-09-15', priced: true }
    exchanges.mockResolvedValue(overview({ wallet: null, receipts: [receipt] }))
    const view = await render()
    expect(view.text()).toContain('beyond what an entry can keep')
    expect(view.text()).not.toContain('has come in yet')

    // Must not fire: nothing of the spending currency priced — then it has not come in.
    exchanges.mockResolvedValue(
      overview({ wallet: null, exchanges: [row()], receipts: [{ ...receipt, priced: false }] }),
    )
    const other = await render()
    expect(other.text()).not.toContain('beyond what an entry can keep')
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
    expect(plain.text()).not.toContain(cba(en.exchange.estimated))
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
    expect(cards[2]?.get('.missing').text()).toBe(cba(en.exchange.card_no_official))
    expect(cards[2]?.find('.difference').exists()).toBe(false)
    expect(cards[2]?.findAll('.plate .line')).toHaveLength(1)
    expect(view.text()).not.toMatch(/commission/i)
  })

  it('says the bank’s rate of that day is in doubt when it jumped with nothing before it (С-5)', async () => {
    exchanges.mockResolvedValue(
      overview({ exchanges: [row({ official: null, officialDoubtful: true })] }),
    )
    const view = await render()
    expect(view.get('article .missing').text()).toBe(cba(en.exchange.card_doubtful))
  })

  it('у обмена рублей на лари без курса дня называет НБ Грузии, а не ЦБ РА (MOL-110)', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            received: { minor: 31_200n, currency: 'GEL' },
            rate: null,
            official: null,
          }),
          row({
            id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5f',
            received: { minor: 31_200n, currency: 'GEL' },
            rate: null,
            official: null,
            officialDoubtful: true,
          }),
        ],
      }),
    )
    const view = await render()
    const cards = view.findAll('article')
    expect(cards[0]?.get('.missing').text()).toBe(
      'No National Bank of Georgia rate for this day — nothing to compare with',
    )
    expect(cards[1]?.get('.missing').text()).toBe(
      'The National Bank of Georgia rate of that day is in doubt — no comparison',
    )
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
    // A name that stands at the head of a line and after «the» alike — no «the the» (adversarial Е).
    expect(view.get('article .plate .official .label').text()).toMatch(
      new RegExp(`^${en.exchange.card_source_cbr} on `),
    )
    expect(text).toContain(`than the ${en.exchange.card_source_cbr} rate`)
    expect(text).not.toMatch(/the the/)
    expect(text).not.toMatch(/central bank/i)
  })

  it('without a pair says there is nothing to convert, and offers no preference', async () => {
    exchanges.mockResolvedValue(overview({ pair: null, wallet: null }))
    const view = await render()
    expect(view.text()).toContain(en.settings.same_currencies)
    // The sheet's own «Как меняли» is in the page; the preference is what must be absent.
    expect(view.find('.preference').exists()).toBe(false)
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
    // Not now and still in the focus order (MOL-174): every radio says so, none is disabled.
    const fieldset = view.get('fieldset.preference')
    expect(fieldset.attributes('disabled')).toBeUndefined()
    expect(fieldset.classes()).toContain('inactive')
    for (const radio of fieldset.findAll('input[type="radio"]')) {
      expect(radio.attributes('aria-disabled')).toBe('true')
    }
  })

  it('offline, the preference is not now but stays in the focus order (Ф-6)', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    const fieldset = view.get('fieldset.preference')
    expect(fieldset.attributes('disabled')).toBeUndefined()
    expect(fieldset.get('input[value="personal"]').attributes('aria-disabled')).toBe('true')
    expect(chooseRatePreference).not.toHaveBeenCalled()
  })

  // MOL-189, Ф-34, Д-1: no bin on the card; the question stands over the amendment, «‹» back to it.
  it('removing is asked over the amendment, naming the exchange: «‹», no ×, nothing removed (В-5)', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    expect(view.find('button.remove').exists()).toBe(false)
    expect(view.findAll('.cards li button')).toHaveLength(1)

    await openCard(view)
    const amount = document.querySelector<HTMLInputElement>(
      'dialog[open] input[inputmode="decimal"]',
    )
    if (!amount) throw new Error('no amount field')
    amount.value = '21000'
    amount.dispatchEvent(new Event('input'))
    sheetButton(en.exchange.sheet.remove).click()
    await risen()

    const sheets = document.querySelectorAll('dialog[open]')
    expect(sheets).toHaveLength(2)
    const question = sheets[1]
    expect(question?.textContent).toContain(en.exchange.remove_sheet.title)
    expect(question?.textContent).toContain('₽20,000 → ֏95,000')
    expect(question?.querySelector(`button[aria-label="${en.sheet.close}"]`)).toBeNull()
    expect(removeExchange).not.toHaveBeenCalled()

    // «‹» takes the question away, and what was typed in the amendment is still there.
    question?.querySelector<HTMLButtonElement>(`button[aria-label="${en.nav.back_label}"]`)?.click()
    await flushPromises()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(amount.value).toBe('21000')
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
    // Both sheets go at once, and «Вернуть» is the strip over the tab bar (Ф-29).
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(view.get('.undo-strip').text()).toContain('Exchange deleted')
    // The card went with its row: the focus lands one swipe from undoing it (Н-1).
    expect(document.activeElement?.textContent.trim()).toBe(en.exchange.restore)

    const restore = view.findAll('button').find((button) => button.text() === en.exchange.restore)
    await restore?.trigger('click')
    await flushPromises()
    expect(restoreExchange).toHaveBeenCalledWith(row().id)
    expect(recordExchange).not.toHaveBeenCalled()
    expect(view.text()).not.toContain('Exchange deleted')
  })

  // MOL-225, adversarial Р1-А2 — the same «Bring back» as an income's, by its own composable.
  it('«Bring back» on a slow line says «Bringing back…», at work, with the focus on it', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    restoreExchange.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()

    const restore = view.findAll('button').find((button) => button.text() === en.exchange.restore)
    if (!restore) throw new Error('no «Bring back»')
    await restore.trigger('click')
    await flushPromises()
    expect(restore.find('.words > :not([aria-hidden])').text()).toBe(en.exchange.restoring)
    expect(restore.attributes('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(restore.element)
    await restore.trigger('click')
    expect(restoreExchange).toHaveBeenCalledOnce()
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
    expect(document.activeElement?.closest('.dock')).not.toBeNull()
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

  it('the list read again after a conflict did not come: «the server did not answer», and «Try again»', async () => {
    exchanges
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockResolvedValue(overview())
    recordExchange.mockRejectedValue(new ApiError(ERROR.CONFLICT))
    const view = await render()
    expect(view.find('.status').exists()).toBe(false)

    await recordThroughSheet(view)
    const strip = view.get('.status')
    expect(strip.text()).toContain(en.exchange.error_strip.split('{when}')[0])
    expect(strip.text()).not.toContain('{when}')
    // The list is the one from before the write: nothing says it shows the exchange (self-review №1).
    expect(view.text()).toContain(en.exchange.conflict_stale)
    expect(view.text()).not.toContain(en.exchange.conflict)
    // One «Try again»: the strip over the tab bar holds «Record an exchange» (К-5).
    const retries = view.findAll('button').filter((button) => button.text() === en.state.retry)
    expect(retries).toHaveLength(1)
    expect(recordButton(view)?.text()).toBe(en.exchange.record)

    // Failed again: the same strip, a new attempt said again (C1).
    const before = view.getComponent(StatusStrip).props('attempt') as number
    await retries[0]?.trigger('click')
    await flushPromises()
    expect(view.get('.status').text()).toContain(en.exchange.error_strip.split('{when}')[0])
    expect(view.getComponent(StatusStrip).props('attempt')).toBe(before + 1)

    await view
      .findAll('button')
      .find((button) => button.text() === en.state.retry)
      ?.trigger('click')
    await flushPromises()
    expect(view.find('.status').exists()).toBe(false)
    expect(exchanges).toHaveBeenCalledTimes(4)
    // Read at last: now the list does show it.
    expect(view.text()).toContain(en.exchange.conflict)
    expect(view.text()).not.toContain(en.exchange.conflict_stale)
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
    // The sheets stay with the word in them (adversarial А5); put away, it stays above the list.
    document
      .querySelector<HTMLButtonElement>(`dialog[open] button[aria-label="${en.sheet.close}"]`)
      ?.click()
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()

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

  // The ten seconds ran out: the screen offers it no more (Ф-29).
  it('«Bring back» goes when its ten seconds run out', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    view.getComponent(UndoStrip).vm.$emit('expire')
    await flushPromises()
    expect(view.find('.undo-strip').exists()).toBe(false)
    expect(restoreExchange).not.toHaveBeenCalled()
  })

  // Ф-6, owner's В-2 «а»: offline «Bring back» says why, and the ten seconds wait for the connection.
  it('«Bring back» without a connection is not now, says why, and its count stands still', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    const strip = view.getComponent(UndoStrip)
    expect(strip.props('waiting')).toBe(true)
    const restore = strip.get('button')
    expect(restore.text()).toBe(en.exchange.restore_offline)
    expect(restore.attributes('aria-disabled')).toBe('true')
    await restore.trigger('click')
    await flushPromises()
    expect(restoreExchange).not.toHaveBeenCalled()
  })

  // MOL-189, adversarial А3: both sheets wait for the server — «Deleting…» is seen, and the card is
  // not opened again under them; the answer closes them, and the strip comes after.
  it('«Delete» keeps both sheets up and at work until the server answers', async () => {
    exchanges.mockResolvedValue(overview())
    let land: (answer: ExchangesResponse) => void = () => undefined
    removeExchange.mockReturnValue(new Promise((resolve) => (land = resolve)))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    const sheets = document.querySelectorAll('dialog[open]')
    expect(sheets).toHaveLength(2)
    expect(sheets[1]?.querySelector('button[aria-busy="true"]')?.textContent).toContain(
      en.exchange.remove_sheet.confirm_busy,
    )
    expect(view.find('.undo-strip').exists()).toBe(false)

    land(overview({ exchanges: [], wallet: null }))
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(view.findAll('.cards button.body')).toHaveLength(0)
    expect(view.find('.undo-strip').exists()).toBe(true)
    expect(document.activeElement?.textContent.trim()).toBe(en.exchange.restore)
  })

  // Adversarial А5: nothing was removed, so nothing typed is lost — both sheets stay and say why.
  it('a removal that failed leaves both sheets and what was typed, the word in the question', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await openCard(view)
    const amount = document.querySelector<HTMLInputElement>(
      'dialog[open] input[inputmode="decimal"]',
    )
    if (!amount) throw new Error('no amount field')
    amount.value = '21000'
    amount.dispatchEvent(new Event('input'))
    sheetButton(en.exchange.sheet.remove).click()
    await risen()
    confirmButton().click()
    await flushPromises()

    const question = document.querySelectorAll('dialog[open]')[1]
    expect(question?.querySelector('[role="alert"]')?.textContent).toBe(en.exchange.failed)
    expect(view.find('.undo-strip').exists()).toBe(false)
    question?.querySelector<HTMLButtonElement>(`button[aria-label="${en.nav.back_label}"]`)?.click()
    await flushPromises()
    expect(amount.value).toBe('21000')
    // Asked again, the question starts clean.
    sheetButton(en.exchange.sheet.remove).click()
    await risen()
    expect(document.querySelectorAll('dialog[open]')[1]?.textContent).not.toContain(
      en.exchange.failed,
    )
  })

  // Adversarial Б1: a removal that fails once its question was put away says so above the list only —
  // the next question opens clean, of another exchange too.
  it('a removal that fails after the sheets were put away leaves the next question clean', async () => {
    const other = row({ id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e', exchangedOn: '2026-09-10' })
    exchanges.mockResolvedValue(overview({ exchanges: [row(), other] }))
    let fail: (reason: unknown) => void = () => undefined
    removeExchange.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    await putBothAway()
    expect(document.querySelector('dialog[open]')).toBeNull()
    fail(new TypeError('network'))
    await flushPromises()
    expect(view.get('.notice.failed').text()).toBe(en.exchange.failed)

    await view.findAll('.cards button.body')[1]?.trigger('click')
    await risen()
    sheetButton(en.exchange.sheet.remove).click()
    await risen()
    expect(document.querySelector('dialog[open] .failed[role="alert"]')).toBeNull()
  })

  // Adversarial Б2: a removal that lands under the sheet of another exchange keeps its strip until that
  // sheet goes — under a modal sheet «Bring back» cannot be reached, and its ten seconds ran out there.
  it('a removal that lands under another sheet: the strip comes when it goes, with its ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const other = row({ id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e', exchangedOn: '2026-09-10' })
    exchanges.mockResolvedValue(overview({ exchanges: [row(), other] }))
    let land: (answer: ExchangesResponse) => void = () => undefined
    removeExchange.mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    await putBothAway()
    await view.findAll('.cards button.body')[1]?.trigger('click')
    await risen()

    land(overview({ exchanges: [other] }))
    await flushPromises()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)
    expect(view.find('.undo-strip').exists()).toBe(false)
    vi.advanceTimersByTime(10_000)

    document
      .querySelector<HTMLButtonElement>(`dialog[open] button[aria-label="${en.sheet.close}"]`)
      ?.click()
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(view.get('.undo-strip .count').text()).toBe('10')
    expect(document.activeElement?.textContent.trim()).toBe(en.exchange.restore)
    expect(restoreExchange).not.toHaveBeenCalled()
  })

  // Adversarial В1: a strip waiting behind the sheet of another exchange keeps waiting while that one
  // is removed from it — and when that removal fails, until the sheets go.
  it('a strip waiting behind another sheet waits through that sheet’s own failed removal', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const other = row({ id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e', exchangedOn: '2026-09-10' })
    exchanges.mockResolvedValue(overview({ exchanges: [row(), other] }))
    let land: (answer: ExchangesResponse) => void = () => undefined
    let fail: (reason: unknown) => void = () => undefined
    removeExchange
      .mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    await putBothAway()
    await view.findAll('.cards button.body')[1]?.trigger('click')
    await risen()
    land(overview({ exchanges: [other] }))
    await flushPromises()

    sheetButton(en.exchange.sheet.remove).click()
    await risen()
    confirmButton().click()
    await flushPromises()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(2)
    expect(view.find('.undo-strip').exists()).toBe(false)
    fail(new TypeError('network'))
    await flushPromises()
    expect(view.find('.undo-strip').exists()).toBe(false)
    vi.advanceTimersByTime(10_000)

    await putBothAway()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(view.get('.undo-strip .count').text()).toBe('10')
    expect(restoreExchange).not.toHaveBeenCalled()
  })

  // Adversarial В2: «‹» while it removes, and it fails — the amendment still up says so itself; the
  // screen's word is under the modal sheet.
  it('a removal that fails after «‹» is said in the amendment still up', async () => {
    exchanges.mockResolvedValue(overview())
    let fail: (reason: unknown) => void = () => undefined
    removeExchange.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    const sheets = document.querySelectorAll('dialog[open]')
    sheets[1]
      ?.querySelector<HTMLButtonElement>(`button[aria-label="${en.nav.back_label}"]`)
      ?.click()
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await risen()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)

    fail(new TypeError('network'))
    await flushPromises()
    expect(document.querySelector('dialog[open] .failed[role="alert"]')?.textContent).toBe(
      en.exchange.failed,
    )
  })

  // Review №4, adversarial Г1: the word about the removal goes with the amendment's next save, as the
  // sheet's own word does — it speaks of the last write of the place.
  it('the word about a failed removal goes when the amendment saves', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockRejectedValueOnce(new TypeError('network'))
    amendExchange.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    // The question put away before the answer.
    document
      .querySelectorAll('dialog[open]')[1]
      ?.querySelector<HTMLButtonElement>(`button[aria-label="${en.nav.back_label}"]`)
      ?.click()
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    await flushPromises()
    expect(document.querySelector('dialog[open] .failed[role="alert"]')?.textContent).toBe(
      en.exchange.failed,
    )

    sheetButton(en.exchange.sheet.save_amend).click()
    await flushPromises()
    expect(amendExchange).toHaveBeenCalledOnce()
    expect(document.querySelector('dialog[open] .failed[role="alert"]')).toBeNull()
  })

  // MOL-189 review №2, adversarial А1: the strip a failed «Bring back» leaves still runs out.
  it('a «Bring back» that failed lets the count go on, and the strip goes when it runs out', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    restoreExchange.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 5))
    vi.advanceTimersByTime(3_000)
    await view.get('.undo-strip button').trigger('click')
    await flushPromises()
    expect(restoreExchange).toHaveBeenCalledOnce()
    expect(view.text()).toContain(en.exchange.failed)

    await view.get('.undo-strip').trigger('pointerleave')
    ;(document.activeElement as HTMLElement | null)?.blur()
    vi.advanceTimersByTime(6_000)
    await flushPromises()
    expect(view.get('.undo-strip .count').text()).toBe('1')
    vi.advanceTimersByTime(1_000)
    await flushPromises()
    expect(view.find('.undo-strip').exists()).toBe(false)
  })

  // Adversarial А2: the rate switch in the air makes the removal final when it lands; «Bring back»
  // meanwhile is not now, as before MOL-189, never a tap that sends nothing.
  it('«Bring back» waits, its count standing, while another write of the screen is in the air', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const other = row({ id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e', exchangedOn: '2026-09-10' })
    exchanges.mockResolvedValue(overview({ exchanges: [row(), other] }))
    removeExchange.mockResolvedValue(overview({ exchanges: [other] }))
    let land: (answer: ExchangesResponse) => void = () => undefined
    chooseRatePreference.mockReturnValue(new Promise((resolve) => (land = resolve)))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 5))

    await view.get('input[value="official"]').setValue(true)
    await flushPromises()
    const restore = view.get('.undo-strip button')
    expect(restore.attributes('aria-disabled')).toBe('true')
    expect(restore.text()).toBe(en.exchange.restore)
    vi.advanceTimersByTime(3_000)
    await flushPromises()
    expect(view.get('.undo-strip .count').text()).toBe('10')
    await restore.trigger('click')
    expect(restoreExchange).not.toHaveBeenCalled()

    land(overview({ exchanges: [other], preference: 'official' }))
    await flushPromises()
    expect(view.find('.undo-strip').exists()).toBe(false)
  })

  // Adversarial А4, MOL-225 Р1-А3: a line that drops while «Bring back» works is not «not now».
  it('«Bring back» at work keeps its words when the line drops', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    restoreExchange.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    await askToRemove(view)
    confirmButton().click()
    await flushPromises()
    const restore = view.get('.undo-strip button')
    await restore.trigger('click')
    await flushPromises()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(restore.attributes('aria-busy')).toBe('true')
    expect(restore.get('.words > [aria-hidden="true"]').text()).toBe(en.exchange.restore)
  })

  // MOL-189, С-19: what waits for the connection says so in the sheet, not by a dead card.
  it('without a connection a card still opens; the sheet says what waits, and both buttons wait', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    await openCard(view)
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain(en.exchange.sheet.offline)
    const save = sheetButton(en.exchange.sheet.save_offline)
    const remove = sheetButton(en.exchange.sheet.remove_offline)
    for (const button of [save, remove]) {
      expect(button.getAttribute('aria-disabled')).toBe('true')
      expect(button.disabled).toBe(false)
      button.click()
    }
    await flushPromises()
    expect(amendExchange).not.toHaveBeenCalled()
    expect(document.querySelectorAll('dialog[open]')).toHaveLength(1)

    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(sheet?.textContent).not.toContain(en.exchange.sheet.offline)
    expect(sheetButton(en.exchange.sheet.save_amend).getAttribute('aria-disabled')).toBeNull()
    expect(sheetButton(en.exchange.sheet.remove).getAttribute('aria-disabled')).toBeNull()
  })

  it('without a connection shows what it has, and writes nothing', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()

    // One line, with the time of the answer on screen (MOL-181); never red, nothing to retry.
    const strip = view.get('.status')
    expect(strip.text()).toContain(en.exchange.offline.strip.split('{when}')[0])
    expect(strip.text()).toMatch(/\d{1,2}:\d{2}/)
    expect(strip.text()).not.toContain(en.state.retry)
    // «Записать обмен» stays in the strip, not now, saying why, and a tap on it opens nothing (Ф-6).
    const record = recordButton(view)
    expect(record?.text()).toBe(en.exchange.record_offline)
    expect(record?.attributes('aria-disabled')).toBe('true')
    await record?.trigger('click')
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()

    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(recordButton(view)?.text()).toBe(en.exchange.record)
    expect(recordButton(view)?.attributes('aria-disabled')).toBeUndefined()
  })

  it('offline with no switch of the rate on screen, the strip names only the recording (А3)', async () => {
    const offlineStrip = async (answer: ExchangesResponse) => {
      exchanges.mockResolvedValue(answer)
      const view = await render()
      online(false)
      window.dispatchEvent(new Event('offline'))
      await flushPromises()
      return view.get('.status').text()
    }
    const recordOnly = en.exchange.offline.strip_record.split('{when}')[1] ?? ''
    const withRate = en.exchange.offline.strip.split('{when}')[1] ?? ''

    // Empty, and one currency for spending and income: «Записать обмен» is all that waits.
    for (const answer of [overview({ exchanges: [], wallet: null }), overview({ pair: null })]) {
      const text = await offlineStrip(answer)
      expect(text).toContain(recordOnly)
      expect(text).not.toContain(withRate)
    }
    // With a pair the switch is there, not now, and the strip names it.
    expect(await offlineStrip(overview())).toContain(withRate)
  })

  it('a night offline: the answer of 23:40 is «yesterday» once the app is looked at again (А2)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 9, 14, 23, 40))
      exchanges.mockResolvedValue(overview())
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
      expect(exchanges).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('«Record an exchange» is named by its words in the strip, with exchanges and empty (Ф-28)', async () => {
    exchanges.mockResolvedValue(overview())
    const full = await render()
    const record = recordButton(full)
    expect(record?.text()).toBe(en.exchange.record)
    expect(record?.attributes('aria-label')).toBeUndefined()
    expect(record?.attributes('aria-disabled')).toBeUndefined()
    // The frame's strip, under the list — the room for it is kept at the end of the content.
    expect(full.find('.dock-room').exists()).toBe(true)

    exchanges.mockResolvedValue(overview({ exchanges: [], wallet: null }))
    const empty = await render()
    expect(empty.text()).toContain(en.exchange.empty.title)
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

  it('a conflict or a vanished exchange read again and not answered: no «here it is now» (self-review №1)', async () => {
    for (const [code, stale, shown] of [
      [ERROR.CONFLICT, en.exchange.amend_conflict_stale, en.exchange.amend_conflict],
      [ERROR.NOT_FOUND, en.exchange.vanished_stale, en.exchange.vanished],
    ] as const) {
      exchanges
        .mockReset()
        .mockResolvedValueOnce(overview())
        .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
        .mockResolvedValue(overview({ exchanges: [row({ revision: 2 })] }))
      amendExchange.mockReset().mockRejectedValueOnce(new ApiError(code))
      const view = await render()
      await openRow(view)
      await saveAmendment()
      expect(view.get('.status').text()).toContain(en.exchange.error_strip.split('{when}')[0])
      expect(view.text()).toContain(stale)
      expect(view.text()).not.toContain(shown)

      await view
        .findAll('button')
        .find((button) => button.text() === en.state.retry)
        ?.trigger('click')
      await flushPromises()
      expect(view.text()).toContain(shown)
      expect(view.text()).not.toContain(stale)
      view.unmount()
      views.splice(views.indexOf(view), 1)
      document.body.innerHTML = ''
    }
  })

  // MOL-187 №8: under the modal sheet the screen's «Try again» cannot be pressed, and the version the
  // sheet held was the one from before — «Now recorded» by it was untrue, and the second save conflicted.
  it('a conflict read again and not answered: the sheet says so itself, with its own «Try again»', async () => {
    exchanges
      .mockResolvedValueOnce(overview())
      .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
      .mockResolvedValue(overview({ exchanges: [row({ revision: 2, note: 'airport' })] }))
    amendExchange.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
    const view = await render()
    await openRow(view)
    await saveAmendment()
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain(en.exchange.sheet.amend_conflict_stale)
    expect(sheet?.textContent).not.toContain(en.exchange.sheet.current.split('{details}')[0])
    expect(sheet?.textContent).toContain(en.exchange.sheet.unanswered)

    // A real millisecond, as a finger takes: Vue drops an event no later than the moment its handler
    // was attached (`_vts` in runtime-dom), and «Try again» was drawn by the answer just landed.
    await new Promise((resolve) => setTimeout(resolve, 5))
    sheetButton(en.state.retry).click()
    await flushPromises()
    expect(sheet?.textContent).toContain(en.exchange.sheet.amend_conflict)
    expect(sheet?.textContent).toContain('airport')
    expect(sheet?.textContent).not.toContain(en.exchange.sheet.unanswered)

    amendExchange.mockResolvedValue(overview())
    await saveAmendment()
    expect(amendExchange.mock.calls.at(-1)?.[1]).toMatchObject({ revision: 2 })
  })

  // Б1 in the sheet: the connection gone, the sheet's own strip says so and offers nothing to retry.
  it('the same read lost with the connection: the sheet says it is offline, with no «Try again»', async () => {
    exchanges
      .mockResolvedValueOnce(overview())
      .mockImplementationOnce(() => {
        online(false)
        window.dispatchEvent(new Event('offline'))
        return Promise.reject(new ApiError(ERROR.INTERNAL, 'network', false))
      })
      .mockResolvedValue(overview({ exchanges: [row({ revision: 2 })] }))
    amendExchange.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT))
    const view = await render()
    await openRow(view)
    await saveAmendment()
    const sheet = document.querySelector('dialog[open]')
    expect(sheet?.textContent).toContain(en.exchange.sheet.offline)
    expect(sheet?.textContent).toContain(en.exchange.sheet.amend_conflict_stale)
    expect(
      [...(sheet?.querySelectorAll('button') ?? [])].map((b) => b.textContent.trim()),
    ).not.toContain(en.state.retry)
  })

  it('the same read lost with the connection: no «here it is now» either, until it is read (Б1)', async () => {
    // The connection goes the moment the server's answer to the write comes.
    const lostOffline = (): Promise<never> => {
      online(false)
      window.dispatchEvent(new Event('offline'))
      return Promise.reject(new ApiError(ERROR.INTERNAL, 'network', false))
    }
    for (const [write, stale, shown] of [
      ['record', en.exchange.conflict_stale, en.exchange.conflict],
      [ERROR.CONFLICT, en.exchange.amend_conflict_stale, en.exchange.amend_conflict],
      [ERROR.NOT_FOUND, en.exchange.vanished_stale, en.exchange.vanished],
    ] as const) {
      online(true)
      exchanges
        .mockReset()
        .mockResolvedValueOnce(overview())
        .mockImplementationOnce(lostOffline)
        .mockResolvedValue(overview({ exchanges: [row({ revision: 2 })] }))
      recordExchange.mockReset().mockRejectedValue(new ApiError(ERROR.CONFLICT))
      amendExchange.mockReset()
      const view = await render()
      if (write === 'record') await recordThroughSheet(view)
      else {
        amendExchange.mockRejectedValueOnce(new ApiError(write))
        await openRow(view)
        await saveAmendment()
      }
      expect(view.get('.status').text()).toContain(en.exchange.offline.strip.split('{when}')[0])
      expect(view.text()).toContain(stale)
      expect(view.text()).not.toContain(shown)

      // Back online, the list is read by itself, and now it is what the words say.
      online(true)
      window.dispatchEvent(new Event('online'))
      await flushPromises()
      expect(exchanges).toHaveBeenCalledTimes(3)
      expect(view.text()).toContain(shown)
      expect(view.text()).not.toContain(stale)
      view.unmount()
      views.splice(views.indexOf(view), 1)
      document.body.innerHTML = ''
    }
  })

  // Near parity the bank's rate falls on the other side of one than the exchange's own; the plate
  // prints it on the exchange's side all the same, not «1.01 $/€» over «1.01 €/$» (adversarial Г).
  it('prints the bank’s rate on the side of the exchange’s own, near parity too', async () => {
    const perEuro = (value: string, source: 'personal' | 'official') => ({
      ...rate(value, '2026-09-15', source),
      base: 'EUR' as const,
      quote: 'USD' as const,
    })
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            given: { minor: 100_000n, currency: 'USD' },
            received: { minor: 99_500n, currency: 'EUR' },
            rate: perEuro('1.005025', 'personal'),
            official: {
              rate: perEuro('0.995', 'official'),
              provider: 'cba',
              difference: { minor: -1_003n, currency: 'EUR' },
            },
          }),
        ],
      }),
    )
    const view = await render()
    const values = view.findAll('article .plate .value').map((value) => value.text())
    expect(values).toEqual(['1.01 $/€', '0.995 $/€'])
  })

  // The tests run in UTC, where Yerevan's midnight is the evening before (adversarial Ж): a day of
  // Yerevan is printed as that calendar day, never as the moment of its midnight.
  it('prints the day of the exchange as the day it was, west of Yerevan too', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    expect(view.get('article .day').text()).toBe('Sep 15')
    expect(view.get('button.body').text()).toMatch(/^Amend the exchange of Sep 15:/)
  })

  // «Today» and «Yesterday» by the phone's calendar, day against day (MOL-121, В-1, В-3): at 20:30
  // UTC it is the 28th here and the 29th in Yerevan. The button keeps the date.
  it('heads the card of the phone’s today «Today», of yesterday «Yesterday»', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-28T20:30:00Z'))
    try {
      const heads: string[] = []
      for (const exchangedOn of ['2026-09-28', '2026-09-27', '2026-09-29']) {
        exchanges.mockResolvedValue(overview({ exchanges: [row({ exchangedOn })] }))
        const view = await render()
        heads.push(view.get('article .day').text())
        if (exchangedOn === '2026-09-28') {
          expect(view.get('button.body').text()).toMatch(/^Amend the exchange of Sep 28:/)
        }
        view.unmount()
      }
      expect(heads).toEqual(['Today', 'Yesterday', 'Sep 29'])

      // Back in view after the phone's midnight, with nothing read again (adversarial Н).
      exchanges.mockResolvedValue(overview({ exchanges: [row({ exchangedOn: '2026-09-28' })] }))
      const view = await render()
      vi.setSystemTime(new Date('2026-09-29T00:20:00Z'))
      document.dispatchEvent(new Event('visibilitychange'))
      await flushPromises()
      expect(view.get('article .day').text()).toBe('Yesterday')
    } finally {
      vi.useRealTimers()
    }
  })

  // The same for every day the card of the wallet names (MOL-121): the texts were checked up to
  // the date, and a day printed as its midnight in the phone's zone stayed green.
  it('names the days of the wallet as the days they were, west of Yerevan too', async () => {
    exchanges.mockResolvedValue(
      overview({
        wallet: { rate: rate('4.3', '2026-09-20'), basis: 'last', estimated: false },
        baseSince: '2026-09-18',
        costs: [
          {
            rate: { ...rate('80', '2026-09-20'), base: 'USD', quote: 'RUB' },
            basis: 'income',
            estimated: false,
          },
        ],
      }),
    )
    const known = await render()
    expect(known.text()).toContain('by the last exchange · since Sep 20')
    expect(known.text()).toContain('Counting in ₽ since Sep 18 —')
    expect(known.get('.costs').text()).toContain('by the last income · since Sep 20')
    known.unmount()

    exchanges.mockResolvedValue(
      overview({
        wallet: null,
        walletUnknown: { on: '2026-08-25', given: 'USD', reason: 'noRate' },
      }),
    )
    const lost = await render()
    expect(lost.text()).toContain('Rate unknown: the $ → ֏ exchange of Aug 25 has')
  })

  it('the row is named by its words, the rate and the comparison included (С-3)', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    const button = view.get('button.body')
    expect(button.attributes('aria-label')).toBeUndefined()
    // The verb and the day first, unseen; the head with the day is inside the button (MOL-189).
    expect(button.text()).toMatch(/^Amend the exchange of .+:/)
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

describe('ExchangeView: against the market of the day (MOL-137)', () => {
  const quote = (
    value: string,
    minor: bigint,
    channel: 'bankCash' | 'bankNoncash' | 'exchanger',
    basis: 'bankCash' | 'bankNoncash' | 'banksAll' | 'exchanger' = channel,
  ) => ({
    channel,
    basis,
    rate: rate(value, '2026-09-15', 'official'),
    difference: { minor, currency: 'AMD' as const },
  })

  it('puts the best of the day first, the own channel under it, the central bank quieter last', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            channel: 'bankCash',
            market: {
              best: quote('4.221606', -123_212n, 'bankNoncash'),
              own: quote('4.110180', 99_640n, 'bankCash'),
              exchangersPending: true,
            },
          }),
        ],
      }),
    )
    const view = await render()
    const card = view.get('article')
    const labels = card.findAll('.plate > .line .label').map((label) => label.text())
    expect(labels).toEqual([
      en.exchange.card_rate,
      'Best rate on Sep 15: Banks, non-cash',
      'Banks, cash on Sep 15',
    ])
    // Against the market: the sign, the word and the tone, each line its own (Ф-30).
    const differences = card.findAll('.plate > .difference')
    expect(differences.map((line) => line.text())).toEqual([
      '−֏1,232.12 · worse than at banks non-cash',
      '+֏996.40 · better than at banks for cash',
    ])
    expect(differences[0]?.classes()).toContain('bad')
    expect(differences[1]?.classes()).toContain('good')
    expect(card.get('.plate > .missing').text()).toBe(en.exchange.market.pending)
    // The central bank is still there, a step quieter and with no tone: it is not the market (Р-5, Д-5).
    expect(card.get('.official').classes()).toContain('quiet')
    const official = card.get('.official .difference')
    expect(official.text()).toBe('֏8,754 more than the central bank')
    expect(official.classes()).not.toContain('good')
    expect(official.classes()).not.toContain('bad')
  })

  it('even with the market is said in words and takes no tone', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            market: { best: quote('4.75', 0n, 'exchanger'), own: null, exchangersPending: false },
          }),
        ],
      }),
    )
    const line = (await render()).get('article .plate > .difference')
    expect(line.text()).toBe('Exactly as at exchange offices')
    expect(line.classes()).not.toContain('good')
    expect(line.classes()).not.toContain('bad')
  })

  it('must not fire: no market — the central bank is the main line, neutral, never toned', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            official: {
              rate: rate('4.80', '2026-09-15', 'official'),
              provider: 'cba',
              difference: { minor: -250_000n, currency: 'AMD' },
            },
          }),
        ],
      }),
    )
    const card = (await render()).get('article')
    expect(card.get('.official').classes()).not.toContain('quiet')
    const line = card.get('.official .difference')
    expect(line.text()).toBe('֏2,500 less than the central bank')
    expect(line.classes()).not.toContain('bad')
  })

  it('names the row of all bank clients where it stood in for non-cash (В-2)', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            market: {
              best: quote('4.2095', -10_000n, 'bankNoncash', 'banksAll'),
              own: null,
              exchangersPending: false,
            },
          }),
        ],
      }),
    )
    const view = await render()
    expect(view.get('article .plate > .line + .line .label').text()).toBe(
      'Best rate on Sep 15: Banks, all clients',
    )
    expect(view.get('article .plate > .difference').text()).toContain('at banks (all clients)')
    expect(view.find('article .plate > .missing').exists()).toBe(false)
  })

  it('with a market and no bank rate that day, does not say there is nothing to compare with', async () => {
    exchanges.mockResolvedValue(
      overview({
        exchanges: [
          row({
            official: null,
            market: {
              best: quote('4.110180', 99_640n, 'bankCash'),
              own: null,
              exchangersPending: false,
            },
          }),
        ],
      }),
    )
    const view = await render()
    expect(view.get('article .official .missing').text()).toBe(
      cba(en.exchange.card_no_official_short),
    )
  })

  it('without a market the central bank stands as it did', async () => {
    exchanges.mockResolvedValue(overview())
    const view = await render()
    expect(view.get('article .official').classes()).not.toContain('quiet')
    expect(view.find('.market').exists()).toBe(false)
  })

  it('shows today’s rates by the central bank, the best starred and said aloud', async () => {
    const rouble = (value: string, day: string) => ({ ...rate(value, day, 'official') })
    exchanges.mockResolvedValue(
      overview({
        marketToday: [
          {
            currency: 'RUB',
            official: rouble('4.3187', '2026-09-29'),
            quotes: [
              {
                channel: 'bankCash',
                basis: 'bankCash',
                buys: rouble('4.110180', '2026-09-29'),
                sells: rouble('4.347948', '2026-09-29'),
                bestBuys: false,
                bestSells: true,
              },
              {
                channel: 'exchanger',
                basis: 'exchanger',
                buys: rouble('4.157339', '2026-09-20'),
                sells: rouble('4.163228', '2026-09-20'),
                bestBuys: false,
                bestSells: false,
              },
            ],
          },
          { currency: 'USD', official: null, quotes: [] },
        ],
      }),
    )
    const view = await render()
    const block = view.get('.market')
    expect(block.get('h2').text()).toBe(en.exchange.market.title)
    // A currency the bank said nothing of is not drawn at all.
    expect(block.findAll('table')).toHaveLength(1)
    expect(block.get('caption').text()).toContain(en.spending.currency_name.RUB)
    const rows = block.findAll('tbody tr')
    expect(rows.map((one) => one.get('th').text())).toEqual([
      'Banks, cash on Sep 29',
      'Exchange offices on Sep 20',
    ])
    const best = rows[0]?.findAll('td')[1]
    expect(best?.classes()).toContain('best')
    expect(best?.find('svg').exists()).toBe(true)
    expect(best?.text()).toContain(en.exchange.market.best_mark)
    expect(rows[1]?.findAll('.best')).toHaveLength(0)
  })
})

describe('ExchangeView: «Обмены против рынка» on top (MOL-152, MOL-159)', () => {
  const losses = {
    total: { minor: -1_338_100n, currency: 'AMD' as const },
    uncounted: 1,
    groups: [
      {
        place: 'Zvartnots',
        count: 1,
        difference: { minor: -1_460_400n, currency: 'AMD' as const },
        percent: -721,
        level: -1000,
      },
      {
        place: null,
        count: 2,
        difference: { minor: 122_300n, currency: 'AMD' as const },
        percent: 149,
        level: 207,
      },
    ],
  }

  it('stands first, above «my rate»: worst place first, the minus red, no «≈ ₽» and no way out', async () => {
    exchanges.mockResolvedValue(overview({ losses }))
    const view = await render()
    const card = view.get('.losses')
    const rate = view.get('.rate')
    expect(
      card.element.compareDocumentPosition(rate.element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    const text = card.text().replace(/\s/g, ' ')
    expect(text).toContain(en.exchange.vs_market.title)
    expect(text).toContain('−֏13,381')
    expect(text).not.toContain('≈')
    expect(text.indexOf('Zvartnots')).toBeLessThan(text.indexOf(en.exchange.vs_market.no_place))
    expect(text).toContain('Not compared: 1 exchange')
    expect(card.get('.total').classes()).toContain('bad')
    expect(card.find('a').exists()).toBe(false)
  })

  it('the difference takes its tone both ways, and the words stand beside it (Ф-30)', async () => {
    exchanges.mockResolvedValue(overview({ losses }))
    const view = await render()
    const card = view.get('.losses')
    expect(card.get('.word').text()).toBe(en.exchange.vs_market.worse)
    expect(card.get('.word').classes()).toContain('bad')
    const [worse, better] = card.findAll('.row')
    expect(worse?.get('.meta').text()).toBe(`1 exchange · ${en.exchange.vs_market.worse}`)
    expect(worse?.get('.percent').classes()).toContain('bad')
    expect(worse?.get('.amount').classes()).toContain('bad')
    expect(better?.get('.meta').text()).toBe(`2 exchanges · ${en.exchange.vs_market.better}`)
    expect(better?.get('.percent').classes()).toContain('good')
    expect(better?.get('.amount').classes()).toContain('good')

    exchanges.mockResolvedValue(
      overview({ losses: { ...losses, total: { minor: 50_000n, currency: 'AMD' } } }),
    )
    const plus = (await render()).get('.losses')
    expect(plus.get('.total').classes()).toContain('good')
    expect(plus.get('.total').text()).toContain('+')
    expect(plus.get('.word').text()).toBe(en.exchange.vs_market.better)
  })

  it("nothing is no tone and no word; one sign a row — the money's, not a percent rounded to 0 (Р-4)", async () => {
    exchanges.mockResolvedValue(
      overview({
        losses: {
          total: { minor: 0n, currency: 'AMD' },
          uncounted: 0,
          groups: [
            {
              place: 'Even',
              count: 1,
              difference: { minor: 0n, currency: 'AMD' },
              percent: 0,
              level: 0,
            },
            {
              place: 'Hair',
              count: 1,
              difference: { minor: -300n, currency: 'AMD' },
              percent: 0,
              level: -1,
            },
          ],
        },
      }),
    )
    const card = (await render()).get('.losses')
    expect(card.find('.word').exists()).toBe(false)
    expect(card.get('.total').classes()).not.toContain('bad')
    expect(card.get('.total').classes()).not.toContain('good')
    const [even, hair] = card.findAll('.row')
    expect(even?.get('.meta').text()).toBe('1 exchange')
    expect(even?.get('.percent').classes()).not.toContain('bad')
    expect(even?.get('.percent').classes()).not.toContain('good')
    expect(hair?.get('.meta').text()).toBe(`1 exchange · ${en.exchange.vs_market.worse}`)
    expect(hair?.get('.percent').classes()).toContain('bad')
    expect(hair?.get('.amount').classes()).toContain('bad')
  })

  it('a difference whole units would print as 0 is printed as it is, under its tone and word (А1)', async () => {
    const lossesOf = (minor: bigint): ExchangesResponse['losses'] => ({
      total: { minor, currency: 'AMD' },
      uncounted: 0,
      groups: [
        { place: 'Hair', count: 1, difference: { minor, currency: 'AMD' }, percent: 0, level: 0 },
      ],
    })
    const cardOf = async (minor: bigint) => {
      exchanges.mockResolvedValue(overview({ losses: lossesOf(minor) }))
      return (await render()).get('.losses')
    }

    // −0,30 ֏ as the card of the exchange prints it, never «−0 ֏» under «worse than the market».
    const worse = await cardOf(-30n)
    expect(worse.get('.total').text()).toBe('−֏0.30')
    expect(worse.get('.total').classes()).toContain('bad')
    expect(worse.get('.word').text()).toBe(en.exchange.vs_market.worse)
    expect(worse.get('.row .amount').text()).toBe('−֏0.30')

    const better = await cardOf(49n)
    expect(better.get('.total').text()).toBe('+֏0.49')
    expect(better.get('.word').text()).toBe(en.exchange.vs_market.better)

    // Half a unit and more rounds to whole units, as every figure of the card.
    expect((await cardOf(-50n)).get('.total').text()).toBe('−֏1')
    expect((await cardOf(-1_338_149n)).get('.total').text()).toBe('−֏13,381')
    // Nothing stays nothing.
    const even = await cardOf(0n)
    expect(even.get('.total').text()).toBe('֏0')
    expect(even.find('.word').exists()).toBe(false)
  })

  it('must not fire: nothing of the twelve months measured — no card', async () => {
    exchanges.mockResolvedValue(overview({ losses: null }))
    const view = await render()
    expect(view.find('.losses').exists()).toBe(false)
  })
})

describe('ExchangeView: «Курс рубля за месяц, 6 и 12 месяцев» (MOL-161, MOL-168)', () => {
  const period = (step: 'day' | 'week', from: string) => ({
    step,
    steps: [
      { day: from, rate: rate('4.22', from, 'official'), x: 0, level: 0 },
      { day: '2026-09-27', rate: rate('4.25', '2026-09-25', 'official'), x: 1000, level: 1000 },
    ],
    exchanges: [],
    levels: [{ rate: rate('4.24', '2026-09-27', 'official'), level: 600 }],
  })
  const rateCharts = {
    pairs: [
      {
        currency: 'RUB' as const,
        side: 'bankBuys' as const,
        periods: {
          1: period('day', '2026-09-02'),
          6: period('week', '2026-04-05'),
          12: period('week', '2025-10-05'),
        },
      },
    ],
  }
  const title = (months: '1' | '6' | '12') =>
    en.exchange.rate_chart.title.RUB.replace('{period}', en.exchange.rate_chart.period_in[months])

  it('stands under «Обмены против рынка» and above «my rate» (handoff 05)', async () => {
    exchanges.mockResolvedValue(overview({ rateCharts }))
    const view = await render()
    const chart = view.get('.rate-chart')
    expect(chart.text()).toContain(title('12'))
    expect(
      chart.element.compareDocumentPosition(view.get('.rate').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('reads the period from the address, anything but 1 and 6 the year (Р-5)', async () => {
    exchanges.mockResolvedValue(overview({ rateCharts }))
    for (const [path, months] of [
      ['/money/exchange?months=1', '1'],
      ['/money/exchange?months=6', '6'],
      ['/money/exchange?months=7', '12'],
      ['/money/exchange?months=abc', '12'],
    ] as const) {
      const view = await render(path)
      expect(view.get('.rate-chart h2').text()).toBe(title(months))
    }
  })

  it('moves the period by replace, the year with no query, and asks the server nothing (Р-2)', async () => {
    exchanges.mockResolvedValue(overview({ rateCharts }))
    const view = await render()
    const asked = exchanges.mock.calls.length
    const replace = vi.spyOn(router, 'replace')
    await view.findAll('.periods input')[0]?.setValue(true)
    await flushPromises()
    expect(replace).toHaveBeenCalled()
    expect(router.currentRoute.value.query).toEqual({ months: '1' })
    expect(view.get('.rate-chart h2').text()).toBe(title('1'))
    await view.findAll('.periods input')[2]?.setValue(true)
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({})
    expect(view.get('.rate-chart h2').text()).toBe(title('12'))
    expect(exchanges.mock.calls.length).toBe(asked)
  })

  it('the period moved past midnight, the app never hidden: the strip says «yesterday» (Б2)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date(2026, 9, 14, 23, 58))
      exchanges.mockResolvedValue(overview({ rateCharts }))
      const view = await render()
      online(false)
      window.dispatchEvent(new Event('offline'))
      await flushPromises()
      expect(view.get('.status').text()).toContain('today, 11:58 PM')

      // 00:05, the phone in hand all along: nothing told the screen the day changed.
      vi.setSystemTime(new Date(2026, 9, 15, 0, 5))
      await view.findAll('.periods input')[0]?.setValue(true)
      await flushPromises()
      expect(view.get('.status').text()).toContain('yesterday, 11:58 PM')
      expect(exchanges).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('must not fire: no market in the year — no card', async () => {
    exchanges.mockResolvedValue(overview({ rateCharts: null }))
    const view = await render()
    expect(view.find('.rate-chart').exists()).toBe(false)
  })
})
