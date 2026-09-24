import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR, parseRate, yerevanMidnight } from '@molvia/model'
import type { ExchangeView as Row, ExchangesResponse, RatePreference } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import ExchangeView from './ExchangeView.vue'

const exchanges = vi.fn<() => Promise<ExchangesResponse>>()
const chooseRatePreference = vi.fn<(preference: RatePreference) => Promise<ExchangesResponse>>()
const removeExchange = vi.fn<(id: string) => Promise<ExchangesResponse>>()
vi.mock('@/api', () => ({
  api: {
    exchanges: () => exchanges(),
    chooseRatePreference: (preference: RatePreference) => chooseRatePreference(preference),
    removeExchange: (id: string) => removeExchange(id),
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
    rate: rate('4.75', '2026-09-15'),
    official: {
      rate: rate('4.3123', '2026-09-15', 'official'),
      provider: 'cba',
      difference: { minor: 875_400n, currency: 'AMD' },
    },
    ...patch,
  }
}

function overview(patch: Partial<ExchangesResponse> = {}): ExchangesResponse {
  return {
    preference: 'personal',
    pair: { base: 'RUB', quote: 'AMD' },
    wallet: { rate: rate('4.791667', '2026-09-15'), basis: 'weighted' },
    heldEstimate: null,
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
  const view = mount(ExchangeView, { global: { plugins: [pinia, router, createAppI18n('en')] } })
  views.push(view)
  await flushPromises()
  return view
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

beforeEach(() => {
  vi.restoreAllMocks()
  exchanges.mockReset()
  chooseRatePreference.mockReset()
  removeExchange.mockReset()
  online(true)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
})

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
      overview({ wallet: { rate: rate('4.75', '2026-09-15'), basis: 'last' } }),
    )
    const view = await render()
    expect(view.text()).toContain('by the last exchange')
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
    expect(view.get('.row').text()).toContain(en.trip.rate.source_cbr)
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

  it('deletes an exchange named by its amounts, and a failure is said once', async () => {
    exchanges.mockResolvedValue(overview())
    removeExchange.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    const view = await render()

    const remove = view.get('button.remove')
    expect(remove.attributes('aria-label')).toMatch(/Delete the exchange .*20,000\.00.*95,000\.00/)
    await remove.trigger('click')
    await flushPromises()
    expect(removeExchange).toHaveBeenCalledWith(row().id)
    expect(view.get('[role="alert"]').text()).toBe(en.exchange.failed)
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
