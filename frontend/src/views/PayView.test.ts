import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import type { PaymentOffer, PaymentStarted, StartPayment } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import PayView from './PayView.vue'

const offer = vi.fn<() => Promise<PaymentOffer>>()
const start = vi.fn<(body: StartPayment) => Promise<PaymentStarted>>()
const rfCard = vi.fn<(again: boolean) => Promise<void>>()
vi.mock('@/api', () => ({
  api: {
    paymentOffer: () => offer(),
    startPayment: (body: StartPayment) => start(body),
    rfCardTap: (again: boolean) => rfCard(again),
  },
}))
const opened = vi.fn<(url: string) => void>()
vi.mock('@/bankPage', () => ({
  openBankPage: (url: string) => {
    opened(url)
  },
}))

const AMD = (drams: number) => ({ minor: BigInt(drams * 100), currency: 'AMD' as const })
const day = (iso: string) => new Date(`${iso}T12:00:00Z`)

const OFFER: PaymentOffer = {
  access: { shared: day('2026-12-03'), receipts: null },
  tariffs: [
    {
      tariff: 'data',
      cents: 100,
      amount: AMD(390),
      after: { shared: day('2027-01-02'), receipts: null },
    },
    {
      tariff: 'receipts',
      cents: 200,
      amount: AMD(770),
      after: { shared: day('2026-12-03'), receipts: day('2026-12-20') },
    },
    {
      tariff: 'both',
      cents: 250,
      amount: AMD(960),
      after: { shared: day('2027-01-02'), receipts: day('2026-12-20') },
    },
  ],
  tips: [
    { cents: 100, amount: AMD(390) },
    { cents: 300, amount: AMD(1150) },
    { cents: 500, amount: AMD(1920) },
  ],
}

const views: VueWrapper[] = []
async function render(query = ''): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/pay${query}`)
  const view = mount(PayView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('ru')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

/** Money is printed with no-break spaces: compared as plain ones. */
const spaced = (text: string | undefined) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ')

const radios = (view: VueWrapper) => view.findAll('[role="radio"]')
const payButton = (view: VueWrapper) =>
  view.findAll('button').find((button) => button.text().startsWith('Оплатить картой'))

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-21T12:00:00Z'), toFake: ['Date'] })
  for (const fake of [offer, start, rfCard, opened]) fake.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  offer.mockResolvedValue(OFFER)
  rfCard.mockResolvedValue()
  localStorage.clear()
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('«Оплата» (MOL-277)', () => {
  it('offers the three tariffs at the server’s prices, each with where its term stands and would go', async () => {
    const view = await render()

    const rows = radios(view)
    expect(rows.map((row) => row.text())).toEqual([
      expect.stringContaining('Чужие оценки и цены'),
      expect.stringContaining('Распознавание чеков'),
      expect.stringContaining('Оба'),
    ])
    expect(spaced(rows[0]?.text())).toContain('открыто до 3 декабря → продлит до 2 января')
    expect(spaced(rows[0]?.text())).toContain('1 $')
    expect(spaced(rows[0]?.text())).toContain('390 ֏')
    expect(spaced(rows[1]?.text())).toContain('сейчас закрыто → до 20 декабря')
    expect(rows[2]?.text()).toContain(ru.pay.meta.both)
    expect(view.text()).toContain(ru.pay.note)
  })

  it('chooses receipts by default, another by the address, and the button says the chosen price', async () => {
    const view = await render()
    expect(radios(view)[1]?.attributes('aria-checked')).toBe('true')
    expect(spaced(payButton(view)?.text())).toBe('Оплатить картой 770 ֏')

    const chosen = await render('?tariff=both')
    expect(radios(chosen)[2]?.attributes('aria-checked')).toBe('true')
    await radios(chosen)[0]?.trigger('click')
    expect(spaced(payButton(chosen)?.text())).toBe('Оплатить картой 390 ֏')
  })

  it('starts the chosen tariff in the screen’s language and goes to the bank’s page', async () => {
    start.mockResolvedValue({ id: 'p1', url: 'https://bank.test/Pay?id=A1&lang=ru' })
    const view = await render()

    await payButton(view)?.trigger('click')
    await flushPromises()

    // with the price the screen showed (adversarial А4)
    expect(start).toHaveBeenCalledWith({ tariff: 'receipts', amount: AMD(770), lang: 'ru' })
    expect(opened).toHaveBeenCalledWith('https://bank.test/Pay?id=A1&lang=ru')
  })

  it('starts a tip of its cents from its own row', async () => {
    start.mockResolvedValue({ id: 'p1', url: 'https://bank.test/Pay?id=A1&lang=ru' })
    const view = await render()

    const tip = view.findAll('button.list-row').find((row) => spaced(row.text()).startsWith('3 $'))
    await tip?.trigger('click')
    await flushPromises()

    expect(start).toHaveBeenCalledWith({
      tariff: 'tip',
      tipCents: 300,
      amount: AMD(1150),
      lang: 'ru',
    })
  })

  it('says the server’s refusal under the button in the error’s own words, and stays', async () => {
    start.mockRejectedValue(new ApiError('error.payments_day_limited', undefined, true, 429))
    const view = await render()

    await payButton(view)?.trigger('click')
    await flushPromises()

    expect(view.text()).toContain(ru.error.payments_day_limited)
    expect(opened).not.toHaveBeenCalled()
    expect(payButton(view)?.attributes('aria-describedby')).toBeTruthy()
  })

  it('a price changed under the button: says so, reads the offer again and shows the new price (А4)', async () => {
    start.mockRejectedValue(new ApiError('error.payment_price_changed', undefined, true, 409))
    const view = await render()
    offer.mockResolvedValue({
      ...OFFER,
      tariffs: (OFFER.tariffs ?? []).map((tariff) =>
        tariff.tariff === 'receipts' ? { ...tariff, amount: AMD(790) } : tariff,
      ),
    })

    await payButton(view)?.trigger('click')
    await flushPromises()

    expect(view.text()).toContain(ru.error.payment_price_changed)
    expect(offer).toHaveBeenCalledTimes(2)
    expect(spaced(payButton(view)?.text())).toContain('790')
    expect(opened).not.toHaveBeenCalled()
  })

  it('says no price while the CBA is silent — attention, never an error', async () => {
    offer.mockResolvedValue({ ...OFFER, tariffs: null, tips: null })
    const view = await render()
    expect(view.text()).toContain(ru.pay.unpriced.title)
    expect(payButton(view)).toBeUndefined()
  })

  it('decides offline or error after the failure', async () => {
    offer.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await render()).text()).toContain(ru.pay.load_error.title)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await render()).text()).toContain(ru.pay.offline.title)
  })

  it('«У меня только карта РФ» says so and counts the tap, the device’s own repeat apart (Р-8)', async () => {
    const view = await render()
    const ghost = () => view.findAll('button').find((button) => button.text() === ru.pay.rf_card)

    await ghost()?.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain(ru.pay.rf.body)
    expect(rfCard).toHaveBeenLastCalledWith(false)
  })
})
