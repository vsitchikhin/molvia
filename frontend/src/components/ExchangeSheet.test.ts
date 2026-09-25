import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, parseRate, yerevanDate, yerevanMidnight } from '@molvia/model'
import type {
  ExchangeAmendBody,
  ExchangeBody,
  ExchangesResponse,
  ExchangeView,
} from '@molvia/model'
import ExchangeSheet from '@/components/ExchangeSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

const record = vi.fn<(body: ExchangeBody) => Promise<unknown>>()
const amend =
  vi.fn<(id: string, body: ExchangeAmendBody) => Promise<'saved' | 'conflict' | 'gone'>>()

/** The money into each currency as the server would list it: every exchange here gave a price. */
function receiptsOf(exchanges: readonly ExchangeView[]): ExchangesResponse['receipts'] {
  return exchanges.map(({ id, received, exchangedOn }) => ({
    id,
    currency: received.currency,
    on: exchangedOn,
    priced: true,
  }))
}

function overview(patch: Partial<ExchangesResponse> = {}): ExchangesResponse {
  const exchanges: ExchangeView[] = patch.exchanges ?? [
    {
      id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5d',
      exchangedOn: '2026-09-01',
      given: { minor: 2_000_000n, currency: 'RUB' },
      received: { minor: 10_000_000n, currency: 'AMD' },
      heldBefore: null,
      note: null,
      revision: 1,
      amendedAt: null,
      history: [],
      rate: null,
      official: null,
      officialDoubtful: false,
    },
  ]
  return {
    preference: 'personal',
    pair: { base: 'RUB', quote: 'AMD' },
    wallet: {
      rate: {
        base: 'RUB',
        quote: 'AMD',
        scaled: parseRate('5'),
        source: 'personal',
        asOf: yerevanMidnight('2026-09-01'),
      },
      basis: 'last',
      estimated: false,
    },
    costs: [],
    heldEstimates: [
      { held: { minor: 2_000_000n, currency: 'AMD' }, whole: true, from: 'exchange' },
    ],
    baseSince: null,
    walletUnknown: null,
    receipts: receiptsOf(exchanges),
    ...patch,
    exchanges,
  }
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
  state: ExchangesResponse = overview(),
  editing: ExchangeView | null = null,
): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/exchange')
  const view = mount(ExchangeSheet, {
    props: { open: true, overview: state, record, amend, editing },
    attachTo: document.body,
    global: { plugins: [router, createPinia(), createAppI18n('en')] },
  })
  // Past the moment the sheet rises: until then it takes no tap at all.
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

function field(view: VueWrapper, label: string) {
  const found = view.findAll('.field').find((candidate) => candidate.get('label').text() === label)
  if (!found) throw new Error(`no field «${label}»`)
  return found
}

async function fill(view: VueWrapper, given: string, received: string): Promise<void> {
  await field(view, en.exchange.sheet.given).get('input').setValue(given)
  await field(view, en.exchange.sheet.received).get('input').setValue(received)
}

async function save(view: VueWrapper): Promise<void> {
  const button = view.findAll('button').find((one) => one.text() === en.exchange.sheet.save)
  await button?.trigger('click')
  await flushPromises()
}

describe('ExchangeSheet', () => {
  it('starts in the pair the trips convert by, dated today in Yerevan', async () => {
    const view = await render()
    const selects = view
      .findAll('select')
      .map((select) => (select.element as HTMLSelectElement).value)
    expect(selects).toEqual(['RUB', 'AMD'])
    expect(
      (field(view, en.exchange.sheet.day).get('input').element as HTMLInputElement).value,
    ).toBe(yerevanDate(new Date()))
  })

  it('sends the amounts as the person typed them, with what was held when given', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await fill(view, '20 000', '95000,50')
    const held = view
      .findAll('.field')
      .find((candidate) => candidate.get('label').text().includes('held before the exchange'))
    await held?.get('input').setValue('20000')
    await save(view)

    expect(record).toHaveBeenCalledTimes(1)
    const body = record.mock.calls[0]?.[0]
    expect(body).toMatchObject({
      given: { minor: 2_000_000n, currency: 'RUB' },
      received: { minor: 9_500_050n, currency: 'AMD' },
      heldBefore: { minor: 2_000_000n, currency: 'AMD' },
    })
    expect(body?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('asks by an income that gave the currency a price, as by an exchange (MOL-66)', async () => {
    const income = { id: '5d1c6a2b-3e4f-4a5b-8c6d-7e8f9a0b1c2d', currency: 'AMD' as const }
    const view = await render(
      overview({ exchanges: [], receipts: [{ ...income, on: '2026-09-01', priced: true }] }),
    )
    expect(view.text()).toContain('held before the exchange')
  })

  it('asks what was held only from the second exchange of the pair, and hints at it', async () => {
    const first = await render(overview({ wallet: null, heldEstimates: [], exchanges: [] }))
    expect(first.text()).not.toContain('held before the exchange')

    const second = await render()
    expect(second.text()).toContain('held before the exchange')
    expect(second.text()).toContain('By the recorded spending')
    expect(second.text()).toContain('20,000.00')
  })

  it('asks by days, not by the order of entry: a day before every exchange is the first link (С-3)', async () => {
    const view = await render()
    await field(view, en.exchange.sheet.day).get('input').setValue('2026-08-20')
    expect(view.text()).not.toContain('held before the exchange')
    await field(view, en.exchange.sheet.day).get('input').setValue('2026-09-01')
    expect(view.text()).toContain('held before the exchange')
  })

  it('asks what was held of drams bought with dollars too, and never of the currency of conversion (MOL-42)', async () => {
    const view = await render()
    const [given, received] = view.findAll('select')
    await given?.setValue('USD')
    expect(view.text()).toContain('held before the exchange')
    expect(view.text()).toContain('20,000.00')

    // Roubles back for drams: the currency of conversion always costs one, nothing to weigh.
    await given?.setValue('AMD')
    await received?.setValue('RUB')
    expect(view.text()).not.toContain('held before the exchange')

    // Dollars nobody received by an exchange yet: their first link.
    await given?.setValue('RUB')
    await received?.setValue('USD')
    expect(view.text()).not.toContain('held before the exchange')
  })

  it('asks by the exchanges the server says gave the currency a price, and no others (П-1, М1)', async () => {
    const counted = await render(overview({ baseSince: '2026-09-10' }))
    expect(counted.text()).toContain('held before the exchange')
    counted.unmount()

    const [base] = overview().exchanges
    if (!base) throw new Error('the fixture has an exchange')
    // A link of the old reckoning: the wallet does not count it, so nothing held is weighed.
    const [receipt] = receiptsOf([base])
    if (!receipt) throw new Error('the fixture has a receipt')
    const left = await render(overview({ receipts: [{ ...receipt, priced: false }] }))
    expect(left.text()).not.toContain('held before the exchange')
    left.unmount()

    // One that took the cost away after a priced one: it is the latest that decides (Н2).
    const later = { ...base, id: '0b7e2c1a-4d5f-4a6b-8c9d-0e1f2a3b4c5e', exchangedOn: '2026-09-05' }
    const taken = await render(
      overview({
        exchanges: [later, base],
        receipts: [{ ...receipt, id: later.id, on: later.exchangedOn, priced: false }, receipt],
      }),
    )
    expect(taken.text()).not.toContain('held before the exchange')
    // Dated between them, the next exchange follows the priced one.
    await field(taken, en.exchange.sheet.day).get('input').setValue('2026-09-03')
    expect(taken.text()).toContain('held before the exchange')
  })

  it('asks only when this exchange will give a price: not for the old reckoning (О1)', async () => {
    const [base] = overview().exchanges
    if (!base) throw new Error('the fixture has an exchange')
    // Dollars to drams on the 1st; counting in dollars since the 10th.
    const dollars = { ...base, given: { minor: 10_000n, currency: 'USD' as const } }
    const view = await render(
      overview({
        pair: { base: 'USD', quote: 'AMD' },
        baseSince: '2026-09-10',
        exchanges: [dollars],
      }),
    )
    const [given] = view.findAll('select')
    const day = field(view, en.exchange.sheet.day).get('input')

    // Roubles for drams on the 5th: the old reckoning — what was held weighs nothing.
    await given?.setValue('RUB')
    await day.setValue('2026-09-05')
    expect(view.text()).not.toContain('held before the exchange')
    // The same on the 12th: the bank may price the roubles now.
    await day.setValue('2026-09-12')
    expect(view.text()).toContain('held before the exchange')
    // Control: dollars on the 5th give the drams a price.
    await given?.setValue('USD')
    await day.setValue('2026-09-05')
    expect(view.text()).toContain('held before the exchange')
  })

  it('says the hint is about the last exchange alone when what was there before it is unknown', async () => {
    const view = await render(
      overview({
        heldEstimates: [
          { held: { minor: 7_000_000n, currency: 'AMD' }, whole: false, from: 'exchange' },
        ],
      }),
    )
    expect(view.text()).toContain('Of the last exchange ≈')
    expect(view.text()).toContain('70,000.00')
  })

  it('names an income when the hint starts from one (MOL-66, Р-8)', async () => {
    const view = await render(
      overview({
        heldEstimates: [
          { held: { minor: 7_000_000n, currency: 'AMD' }, whole: false, from: 'income' },
        ],
      }),
    )
    expect(view.text()).toContain('Of the last income ≈')
  })

  it('refuses a cleared day under the field, not as a lost connection (Б2)', async () => {
    const view = await render()
    await fill(view, '20000', '95000')
    await field(view, en.exchange.sheet.day).get('input').setValue('')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(field(view, en.exchange.sheet.day).text()).toContain(en.exchange.sheet.bad_day)
    expect(view.find('[role="alert"]').exists()).toBe(false)
  })

  it('refuses amounts no rate says under «Got», before sending and when the server does (А3)', async () => {
    const view = await render()
    await fill(view, '1', '5000000')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(field(view, en.exchange.sheet.received).text()).toContain(en.error.invalid_rate)

    record.mockRejectedValue(new ApiError(ERROR.INVALID_RATE))
    await fill(view, '20000', '95000')
    await save(view)
    expect(field(view, en.exchange.sheet.received).text()).toContain(en.error.invalid_rate)
  })

  it('leaves the held amount out when it is left empty — unknown, not zero', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await fill(view, '20000', '95000')
    await save(view)
    expect(record.mock.calls[0]?.[0]).not.toHaveProperty('heldBefore')
  })

  it('refuses what is not an amount, and one currency on both sides, before sending', async () => {
    const view = await render()
    await fill(view, 'двадцать', '0')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(view.findAll('.error').map((error) => error.text())).toContain(en.error.invalid_amount)

    await fill(view, '20000', '95000')
    await view.findAll('select')[1]?.setValue('RUB')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(view.text()).toContain(en.exchange.sheet.same_currency)
  })

  it('keeps the sheet open with the day marked when the server says the day has not come', async () => {
    record.mockRejectedValue(new ApiError(ERROR.EXCHANGE_IN_FUTURE))
    const view = await render()
    await fill(view, '20000', '95000')
    await save(view)
    expect(field(view, en.exchange.sheet.day).text()).toContain(en.error.exchange_in_future)
    expect(view.emitted('update:open')).toBeUndefined()
  })

  it('a failure says so once, and saving again is the same exchange', async () => {
    record.mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(undefined)
    const view = await render()
    await fill(view, '20000', '95000')
    await save(view)
    expect(view.get('[role="alert"]').text()).toBe(en.exchange.failed)

    await save(view)
    expect(record).toHaveBeenCalledTimes(2)
    expect(record.mock.calls[1]?.[0].id).toBe(record.mock.calls[0]?.[0].id)
  })

  it('keeps a note trimmed, leaves it out when empty, and refuses one that draws nothing (MOL-42)', async () => {
    record.mockResolvedValue(undefined)
    const view = await render()
    await fill(view, '20000', '95000')
    await field(view, en.exchange.sheet.note).get('input').setValue('\u200b')
    await save(view)
    expect(record).not.toHaveBeenCalled()
    expect(field(view, en.exchange.sheet.note).text()).toContain(en.exchange.sheet.bad_note)

    await field(view, en.exchange.sheet.note).get('input').setValue('  VTB cash machine ')
    await save(view)
    expect(record.mock.calls[0]?.[0]).toMatchObject({ note: 'VTB cash machine' })
  })
})

describe('ExchangeSheet: an amendment (MOL-42, В-3)', () => {
  const [base] = overview().exchanges
  if (!base) throw new Error('the fixture has an exchange')
  const amended: ExchangeView = {
    ...base,
    received: { minor: 9_500_000n, currency: 'AMD' },
    note: 'VTB',
    revision: 2,
    amendedAt: new Date('2026-09-25T09:00:00.000Z'),
    history: [
      {
        given: { minor: 2_000_000n, currency: 'RUB' },
        received: { minor: 10_000_000n, currency: 'AMD' },
        exchangedOn: '2026-09-01',
        heldBefore: null,
        note: null,
        replacedAt: new Date('2026-09-25T09:00:00.000Z'),
      },
    ],
  }

  it('starts from what the row says and shows the versions before it', async () => {
    const view = await render(overview({ exchanges: [amended] }), amended)
    expect(view.text()).toContain(en.exchange.sheet.title_amend)
    const value = (label: string) =>
      (field(view, label).get('input').element as HTMLInputElement).value
    expect(value(en.exchange.sheet.given)).toBe('20000')
    expect(value(en.exchange.sheet.received)).toBe('95000')
    expect(value(en.exchange.sheet.day)).toBe('2026-09-01')
    expect(value(en.exchange.sheet.note)).toBe('VTB')
    expect(view.get('.versions').text()).toContain('100,000.00')
    // Its own entry is not an earlier exchange: the first link is asked nothing.
    expect(view.text()).not.toContain('held before the exchange')
  })

  it('saves over the version it was opened on, and says so on the button', async () => {
    amend.mockResolvedValue('saved')
    const view = await render(overview({ exchanges: [amended] }), amended)
    await field(view, en.exchange.sheet.received).get('input').setValue('96000')
    const button = view.findAll('button').find((one) => one.text() === en.exchange.sheet.save_amend)
    await button?.trigger('click')
    await flushPromises()

    expect(record).not.toHaveBeenCalled()
    expect(amend).toHaveBeenCalledWith(amended.id, {
      revision: 2,
      given: { minor: 2_000_000n, currency: 'RUB' },
      received: { minor: 9_600_000n, currency: 'AMD' },
      exchangedOn: '2026-09-01',
      note: 'VTB',
    })
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
  })

  async function saveAmendment(view: VueWrapper): Promise<void> {
    const button = view.findAll('button').find((one) => one.text() === en.exchange.sheet.save_amend)
    await button?.trigger('click')
    await flushPromises()
  }

  it('shows and keeps a remainder the exchange has, even where a new one would not ask (Ж4)', async () => {
    amend.mockResolvedValue('saved')
    const held: ExchangeView = { ...amended, heldBefore: { minor: 2_000_000n, currency: 'AMD' } }
    for (const state of [
      overview({ exchanges: [held], baseSince: '2026-09-10' }),
      overview({ exchanges: [held], pair: null }),
      overview({ exchanges: [held] }),
    ]) {
      amend.mockClear()
      const view = await render(state, held)
      expect(view.text()).toContain('held before the exchange')
      await field(view, en.exchange.sheet.note).get('input').setValue('VTB cash machine')
      await saveAmendment(view)
      expect(amend.mock.calls[0]?.[1]).toMatchObject({
        heldBefore: { minor: 2_000_000n, currency: 'AMD' },
        note: 'VTB cash machine',
      })
      view.unmount()
    }
  })

  it('a conflict keeps the sheet open with what was typed, and says so (Ч-2)', async () => {
    amend.mockResolvedValue('conflict')
    const view = await render(overview({ exchanges: [amended] }), amended)
    await field(view, en.exchange.sheet.received).get('input').setValue('96000')
    await saveAmendment(view)
    expect(view.emitted('update:open')).toBeUndefined()
    expect(view.text()).toContain(en.exchange.sheet.amend_conflict)
    // What the other device wrote is in the sheet itself, not only in the list under it (Л4).
    expect(view.get('.current').text()).toContain('Now recorded: ₽20,000.00 → ֏95,000.00')
    expect(view.get('.current').text()).toContain('VTB')
    expect(
      (field(view, en.exchange.sheet.received).get('input').element as HTMLInputElement).value,
    ).toBe('96000')
  })

  it('names the remainder in «now recorded» — a change of it alone is a change (М2)', async () => {
    amend.mockResolvedValue('conflict')
    const theirs: ExchangeView = { ...amended, heldBefore: { minor: 3_000_000n, currency: 'AMD' } }
    const view = await render(overview({ exchanges: [theirs] }), theirs)
    await saveAmendment(view)
    expect(view.get('.current').text()).toContain('held before ֏30,000.00')
  })
})
