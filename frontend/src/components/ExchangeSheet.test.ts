import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, parseRate, yerevanDate, yerevanMidnight } from '@molvia/model'
import type { ExchangeBody, ExchangesResponse } from '@molvia/model'
import ExchangeSheet from '@/components/ExchangeSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

const record = vi.fn<(body: ExchangeBody) => Promise<unknown>>()

function overview(patch: Partial<ExchangesResponse> = {}): ExchangesResponse {
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
    },
    heldEstimate: { minor: 2_000_000n, currency: 'AMD' },
    exchanges: [],
    ...patch,
  }
}

let clock = 0

beforeEach(() => {
  setActivePinia(createPinia())
  record.mockReset()
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

async function render(state: ExchangesResponse = overview()): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/exchange')
  const view = mount(ExchangeSheet, {
    props: { open: true, overview: state, record },
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
    const held = view.findAll('.field').at(-1)
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

  it('asks what was held only from the second exchange of the pair, and hints at it', async () => {
    const first = await render(overview({ wallet: null, heldEstimate: null }))
    expect(first.text()).not.toContain('held before the exchange')

    const second = await render()
    expect(second.text()).toContain('held before the exchange')
    expect(second.text()).toContain('By the recorded spending')
    expect(second.text()).toContain('20,000.00')
  })

  it('does not ask what was held for an exchange of another pair', async () => {
    const view = await render()
    await view.findAll('select')[0]?.setValue('USD')
    expect(view.text()).not.toContain('held before the exchange')
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
})
