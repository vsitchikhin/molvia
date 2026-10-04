import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { RouterView, createRouter, createWebHistory } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, parseMoney, parseQuantity } from '@molvia/model'
import type { ReceiptDetail, ReceiptRecordBody, ReceiptReviewLine } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import CaptureSheet from '@/components/CaptureSheet.vue'
import ReceiptPlaceSheet from '@/components/ReceiptPlaceSheet.vue'
import { stepBack } from '@/navigation'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'

const receipt = vi.fn<(id: string) => Promise<ReceiptDetail>>()
const recordReceipt = vi.fn<(id: string, body: ReceiptRecordBody) => Promise<{ tripId: string }>>()
// Every other call of the API hangs: the screens behind this one load and never answer.
vi.mock('@/api', () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'receipt') return (id: string) => receipt(id)
        if (name === 'recordReceipt')
          return (id: string, body: ReceiptRecordBody) => recordReceipt(id, body)
        if (name === 'receipts') return () => Promise.resolve({ receipts: [] })
        if (name === 'recentPlaces') return () => Promise.resolve([])
        return () => new Promise(() => undefined)
      },
    },
  ),
}))
vi.mock('@/receipts/photoShelf', () => ({
  photoShelf: () => ({
    put: () => Promise.resolve(true),
    get: () => Promise.resolve(null),
    parts: () => Promise.resolve([]),
    drop: () => Promise.resolve(),
    keepOnly: () => Promise.resolve(),
  }),
  forgetPhotos: () => Promise.resolve(),
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const ID = 'cccccccc-0000-4000-8000-000000000001'
const PLACE = 'bbbbbbbb-0000-4000-8000-000000000001'
const TRIP = 'dddddddd-0000-4000-8000-000000000001'
const amd = (value: string) => parseMoney(value, 'AMD')

function line(printed: string, sum: string): ReceiptReviewLine {
  return {
    printed,
    hs: null,
    sku: null,
    quantity: parseQuantity('1', 'piece'),
    price: amd(sum),
    sum: amd(sum),
    discount: null,
    settled: true,
    itemId: 'aaaaaaaa-0000-4000-8000-000000000001',
    itemName: 'Молоко',
    match: 'memory',
    translation: null,
    amount: amd(sum),
    rememberedPrice: null,
  }
}

function detail(over: { place?: boolean; status?: 'parsed' | 'failed' } = {}): ReceiptDetail {
  return {
    receipt: {
      id: ID,
      status: over.status ?? 'parsed',
      failure: null,
      parts: 1,
      received: 1,
      capturedAt: new Date('2026-10-01T10:00:00Z'),
      country: 'AM',
      language: 'ru',
      header: { tin: '01234567', date: '2026-10-01', time: '12:00', receiptNo: '1' },
      total: amd('900'),
      balanced: true,
      lineCount: 2,
      unsettled: 0,
      place:
        over.place === false
          ? null
          : { id: PLACE, name: 'Ереван Сити', city: 'Гюмри', tin: '01234567' },
      tripId: null,
    },
    lines: [line('ԿԱԹ', '500'), line('ՀԱՑ', '400')],
    rate: null,
    duplicateOf: null,
  }
}

let clock = 0
const mounted: VueWrapper[] = []
const App = defineComponent(() => () => h(RouterView))
const sheet = () => document.body.querySelector('dialog[open]')

async function render() {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().state = 'ready'
  window.history.replaceState(null, '', '/')
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push('/purchases')
  await router.push(`/purchases/receipts/${ID}`)
  const view = mount(App, {
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  return { view, router }
}

const button = (view: VueWrapper, text: string) => {
  const found = view.findAll('button').find((one) => one.text().includes(text))
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

describe('ReceiptView (MOL-127)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    receipt.mockReset()
    receipt.mockResolvedValue(detail())
    recordReceipt.mockReset()
    recordReceipt.mockResolvedValue({ tripId: TRIP })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('records under the place found and gives way to the purchases', async () => {
    const { view, router } = await render()
    expect(view.findAll('.receipt-line')).toHaveLength(2)
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    expect(recordReceipt).toHaveBeenCalledTimes(1)
    expect(recordReceipt.mock.calls[0]?.[1].place).toEqual({ id: PLACE })
    expect(router.currentRoute.value.name).toBe('purchase')
    expect(router.currentRoute.value.params.tripId).toBe(TRIP)
  })

  it('with no place read, «Записать» asks for it first and sends nothing', async () => {
    receipt.mockResolvedValue(detail({ place: false }))
    const { view } = await render()
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    clock += 1000
    expect(sheet()?.textContent).toContain(ru.receipt.place.title)
    expect(recordReceipt).not.toHaveBeenCalled()
  })

  it('no place read and no connection: the place, then «Записать» goes up to «Покупки» (review 34)', async () => {
    receipt.mockResolvedValue(detail({ place: false }))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { view, router } = await render()
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    clock += 1000
    const place = view.findComponent(ReceiptPlaceSheet)
    place.vm.$emit('chosen', { name: 'Ереван Сити', city: 'Гюмри' }, '2026-10-01')
    // A browser tells the sheet it is closed from inside the pop of its step, before that step has
    // landed; happy-dom lands it first. So the order is laid by hand: the step in flight, the sheet
    // closed, then the pop.
    const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined)
    stepBack(router)
    place.props('onClosed')?.()
    await flushPromises()
    go.mockRestore()
    window.dispatchEvent(new PopStateEvent('popstate'))
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('purchases')
  })

  it('a late answer moves nobody who already left the review (adversarial А5)', async () => {
    let land: (value: { tripId: string }) => void = () => undefined
    recordReceipt.mockReturnValue(
      new Promise((resolve) => {
        land = resolve
      }),
    )
    const { view, router } = await render()
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    await router.push('/money')
    land({ tripId: TRIP })
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('money')
  })

  it('while «Записать» waits, the receipt is what was sent: no edit, no removal (review 5, А1)', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    // Offline: up to «Покупки», the record in the queue.
    expect(first.router.currentRoute.value.name).toBe('purchases')
    while (mounted.length) mounted.pop()?.unmount()

    const { view } = await render()
    expect(view.text()).toContain(ru.receipt.review.recording)
    expect(view.findAll('button').some((one) => one.text().includes(ru.purchases.delete))).toBe(
      false,
    )
    await view.get('.receipt-line').trigger('click')
    await flushPromises()
    expect(sheet()).toBeNull()
  })

  it('«Отменить запись» opens a record the server answered 5xx: lines, removal and «Записать» are back (MOL-169)', async () => {
    recordReceipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x'))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    expect(first.router.currentRoute.value.name).toBe('purchases')
    while (mounted.length) mounted.pop()?.unmount()

    const { view } = await render()
    expect(view.text()).toContain(ru.receipt.review.recording)
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    expect(view.text()).not.toContain(ru.receipt.review.recording)
    expect(button(view, ru.purchases.delete).exists()).toBe(true)
    expect(button(view, 'Записать 2 покупки').exists()).toBe(true)
    await view.get('.receipt-line').trigger('click')
    await flushPromises()
    expect(sheet()).not.toBeNull()
  })

  it('a record cancelled after its answer was lost, and the server had written it: the receipt read again goes to its purchases', async () => {
    recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    while (mounted.length) mounted.pop()?.unmount()

    const { view, router } = await render()
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    // The first send had landed: the record under another trip is a conflict, and the receipt says so.
    recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'x'))
    const written = detail()
    receipt.mockResolvedValue({
      ...written,
      receipt: { ...written.receipt, status: 'recorded', tripId: TRIP },
    })
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    expect(recordReceipt.mock.calls[1]?.[1].tripId).not.toBe(
      recordReceipt.mock.calls[0]?.[1].tripId,
    )
    expect(router.currentRoute.value.name).toBe('purchase')
    expect(router.currentRoute.value.params.tripId).toBe(TRIP)
  })

  it('«Переснять»: the sheet replaces this receipt, and «sent» takes the screen up (review 2, 31)', async () => {
    receipt.mockResolvedValue(detail({ status: 'failed' }))
    const { view, router } = await render()
    await button(view, ru.receipt.capture.retake).trigger('click')
    await flushPromises()
    const capture = view.findComponent(CaptureSheet)
    expect(capture.props('replacing')).toBe(ID)
    // «sent» comes from the sheet's own `onClosed`, before it lets the screen unmount it (happy-dom
    // closes a dialog at once, so the close itself is end-to-end's).
    capture.vm.$emit('sent', false)
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('purchases')
  })

  it('no answer and nothing kept: an error is red with «Повторить», offline is not (MOL-19)', async () => {
    receipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
    const failed = await render()
    expect(failed.view.text()).toContain(ru.receipt.review.error.title)
    expect(failed.view.text()).toContain(ru.receipt.review.error.body)
    expect(failed.view.find('.state.bad').exists()).toBe(true)
    while (mounted.length) mounted.pop()?.unmount()

    localStorage.clear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    receipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Load failed', false))
    const { view } = await render()
    expect(view.text()).toContain(ru.receipt.review.offline)
    expect(view.find('.state.bad').exists()).toBe(false)
  })

  it('offline, the receipt read before is reviewed from the phone under the strip (MOL-19)', async () => {
    await render()
    while (mounted.length) mounted.pop()?.unmount()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    receipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Load failed', false))
    const { view } = await render()
    expect(view.find('.strip').text()).toContain(ru.receipt.review.offline)
    expect(view.findAll('.receipt-line')).toHaveLength(2)
  })

  it('a receipt the server has no more is said so, with the way back (handoff question 5)', async () => {
    receipt.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'gone'))
    const { view } = await render()
    expect(view.text()).toContain(ru.receipt.gone.title)
    expect(view.text()).toContain(ru.receipt.gone.action)
  })
})
