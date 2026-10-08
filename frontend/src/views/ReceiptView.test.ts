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
import ReceiptBarcodesSheet from '@/components/ReceiptBarcodesSheet.vue'
import ReceiptPlaceSheet from '@/components/ReceiptPlaceSheet.vue'
import { stepBack } from '@/navigation'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'
import { useReceiptDraftsStore } from '@/stores/receiptDrafts'
import { useReceiptQueueStore } from '@/stores/receiptQueue'

const receipt = vi.fn<(id: string) => Promise<ReceiptDetail>>()
const recordReceipt = vi.fn<(id: string, body: ReceiptRecordBody) => Promise<{ tripId: string }>>()
const receipts = vi.fn<() => Promise<{ receipts: ReceiptDetail['receipt'][] }>>()
const receiptSettled = vi.fn<(id: string) => Promise<{ tripId: string | null }>>()
const keepOnly = vi.fn<(named: ReadonlySet<string>) => Promise<void>>()
const shelfParts = vi.fn<(id: string) => Promise<Blob[]>>()
// Every other call of the API hangs: the screens behind this one load and never answer.
vi.mock('@/api', () => ({
  api: new Proxy(
    {},
    {
      get: (_target, name) => {
        if (name === 'receipt') return (id: string) => receipt(id)
        if (name === 'receiptSettled') return (id: string) => receiptSettled(id)
        if (name === 'recordReceipt')
          return (id: string, body: ReceiptRecordBody) => recordReceipt(id, body)
        if (name === 'receipts') return () => receipts()
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
    parts: (id: string) => shelfParts(id),
    drop: () => Promise.resolve(),
    keepOnly: (named: ReadonlySet<string>) => keepOnly(named),
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
      header: { tin: '01234567', date: '2026-10-01', time: '12:00', receiptNo: '1', shop: null },
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

async function render(where = { country: 'AM', city: 'Гюмри' }) {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ ...where, spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
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
    receipts.mockReset()
    receipts.mockResolvedValue({ receipts: [] })
    // The check of «Отменить запись» reads what the receipt says, as the server's own read does.
    receiptSettled.mockReset()
    receiptSettled.mockImplementation((id) =>
      receipt(id).then((one) => ({ tripId: one.receipt.tripId })),
    )
    keepOnly.mockReset()
    keepOnly.mockResolvedValue(undefined)
    shelfParts.mockReset()
    shelfParts.mockResolvedValue([])
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

  // MOL-222, adversarial В1: the line was put right while the review showed the parse's item; read
  // again after another record taught the memory that same correction, it shows the person's word —
  // and «Записать» still says the line was put right
  it('sends a line put right as put right though the review read again shows the same item', async () => {
    const shownThen = 'aaaaaaaa-0000-4000-8000-000000000001'
    const cheese = 'aaaaaaaa-0000-4000-8000-000000000009'
    const reread = detail()
    receipt.mockResolvedValue({
      ...reread,
      lines: reread.lines.map((one, position) =>
        position === 0
          ? { ...one, itemId: cheese, itemName: 'Сыр', match: 'memory' as const }
          : one,
      ),
    })
    const { view } = await render()
    useReceiptDraftsStore().setLine(
      ID,
      0,
      { item: { id: cheese, name: 'Сыр' }, skip: false },
      shownThen,
    )
    await flushPromises()
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    expect(recordReceipt.mock.calls[0]?.[1].edited).toEqual({ item: [0], figures: [] })
  })

  describe('«Привязать штрихкоды?» (MOL-234, owner’s В-2 «а»)', () => {
    const coded = () => {
      const one = detail()
      return {
        ...one,
        lines: [{ ...line('SECER', '500'), code: '8600000000004' }, line('BANANA', '400')],
      }
    }

    /** The sheet answered and put away, the record told once its step has landed — as a browser does. */
    async function answer(
      view: VueWrapper,
      router: Awaited<ReturnType<typeof render>>['router'],
      bind: boolean,
    ) {
      const codes = view.findComponent(ReceiptBarcodesSheet)
      codes.vm.$emit('answered', bind)
      const go = vi.spyOn(window.history, 'go').mockImplementation(() => undefined)
      stepBack(router)
      codes.props('onClosed')?.()
      await flushPromises()
      go.mockRestore()
      window.dispatchEvent(new PopStateEvent('popstate'))
      await flushPromises()
    }

    it('asks before «Записать» sends a receipt with a code, naming the code and the item', async () => {
      receipt.mockResolvedValue(coded())
      const { view } = await render()
      await button(view, 'Записать 2 покупки').trigger('click')
      await flushPromises()
      expect(recordReceipt).not.toHaveBeenCalled()
      expect(sheet()?.textContent).toContain(ru.receipt.codes.title)
      expect(sheet()?.textContent).toContain('8600000000004')
      expect(sheet()?.textContent).toContain('Молоко')
    })

    it('«Привязать и записать» sends the line’s position', async () => {
      receipt.mockResolvedValue(coded())
      const first = await render()
      await button(first.view, 'Записать 2 покупки').trigger('click')
      await flushPromises()
      clock += 1000
      await answer(first.view, first.router, true)
      expect(recordReceipt).toHaveBeenCalledTimes(1)
      expect(recordReceipt.mock.calls[0]?.[1].barcodes).toEqual([0])
    })

    it('«Записать без кодов» records with no codes asked for', async () => {
      receipt.mockResolvedValue(coded())
      const { view, router } = await render()
      await button(view, 'Записать 2 покупки').trigger('click')
      await flushPromises()
      clock += 1000
      await answer(view, router, false)
      expect(recordReceipt).toHaveBeenCalledTimes(1)
      expect(recordReceipt.mock.calls[0]?.[1]).not.toHaveProperty('barcodes')
    })

    it('asks nothing of a receipt with no code', async () => {
      const { view } = await render()
      await button(view, 'Записать 2 покупки').trigger('click')
      await flushPromises()
      expect(recordReceipt).toHaveBeenCalledTimes(1)
      expect(view.findComponent(ReceiptBarcodesSheet).exists()).toBe(false)
    })

    it('put away with no answer records nothing', async () => {
      receipt.mockResolvedValue(coded())
      const { view } = await render()
      await button(view, 'Записать 2 покупки').trigger('click')
      await flushPromises()
      view.findComponent(ReceiptBarcodesSheet).props('onClosed')?.()
      await flushPromises()
      expect(recordReceipt).not.toHaveBeenCalled()
    })
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

  it('a begun record the server has written: «Отменить запись» goes to its purchases, and nothing of it waits (MOL-169, А1, А2)', async () => {
    recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    while (mounted.length) mounted.pop()?.unmount()

    // Opened with no connection: the receipt from the phone, as it was before the send.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    receipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x', false))
    const { view, router } = await render()
    expect(view.text()).toContain(ru.receipt.review.recording)
    // Back online, the server says it was written by that send.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const written = detail()
    receipt.mockReset()
    receipt.mockResolvedValue({
      ...written,
      receipt: { ...written.receipt, status: 'recorded', tripId: TRIP },
    })
    recordReceipt.mockClear()
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('purchase')
    expect(router.currentRoute.value.params.tripId).toBe(TRIP)
    const queue = useReceiptQueueStore()
    expect(queue.pending).toEqual([])
    expect(queue.rejected).toEqual([])
    expect(recordReceipt).not.toHaveBeenCalled()
  })

  it('recorded, the check takes the screen to its purchases on its own answer, with no read after it (round 4, Д1)', async () => {
    recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    while (mounted.length) mounted.pop()?.unmount()

    // The same bad connection: every read of the receipt fails, the check alone gets through.
    receipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x', false))
    const { view, router } = await render()
    receiptSettled.mockReset()
    receiptSettled.mockResolvedValue({ tripId: TRIP })
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('purchase')
    expect(router.currentRoute.value.params.tripId).toBe(TRIP)
    expect(useReceiptQueueStore().pending).toEqual([])
    expect(useReceiptDraftsStore().draftOf(ID)).toBeNull()
  })

  it('a begun record with no answer from the server is not cancelled, and the dock says why (MOL-169, А1)', async () => {
    recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'x', false))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    while (mounted.length) mounted.pop()?.unmount()

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    receipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x', false))
    const { view } = await render()
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    expect(view.text()).toContain(ru.receipt.review.cancel_record_offline)
    expect(view.text()).toContain(ru.receipt.review.recording)
    expect(useReceiptQueueStore().pending).toHaveLength(1)
    expect(view.findAll('button').some((one) => one.text().includes(ru.purchases.delete))).toBe(
      false,
    )
  })

  it('a check decides by its own answer, never a read that set out before it (round 2, Б2)', async () => {
    recordReceipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x'))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    while (mounted.length) mounted.pop()?.unmount()

    const { view } = await render()
    // A read sets out before the tap (back in view) and answers «parsed» only after the check failed.
    let early: (answer: ReceiptDetail) => void = () => undefined
    receipt.mockImplementationOnce(() => new Promise((resolve) => (early = resolve)))
    const before = receipt.mock.calls.length
    window.dispatchEvent(new Event('online'))
    expect(receipt.mock.calls.length).toBe(before + 1)
    // The check's own read answers last, and fails: the early «parsed» came in while it was out.
    let lost: (error: unknown) => void = () => undefined
    receipt.mockImplementationOnce(() => new Promise((_, reject) => (lost = reject)))
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    expect(receipt.mock.calls.length).toBe(before + 2)
    early(detail())
    await flushPromises()
    lost(new ApiError(ERROR.INTERNAL, 'x', false))
    await flushPromises()
    expect(useReceiptQueueStore().pending).toHaveLength(1)
    expect(view.text()).toContain(ru.receipt.review.cancel_record_failed)
    expect(view.text()).toContain(ru.receipt.review.recording)
    expect(view.findAll('button').some((one) => one.text().includes(ru.purchases.delete))).toBe(
      false,
    )
  })

  it('online, a server that does not answer the check is said so, and the words go once online changes (round 2, Б3)', async () => {
    recordReceipt.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'x'))
    const first = await render()
    await button(first.view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    while (mounted.length) mounted.pop()?.unmount()

    const { view } = await render()
    receipt.mockImplementationOnce(() => Promise.reject(new ApiError(ERROR.INTERNAL, 'x')))
    await button(view, ru.receipt.review.cancel_record).trigger('click')
    await flushPromises()
    expect(view.text()).toContain(ru.receipt.review.cancel_record_failed)
    expect(view.text()).not.toContain(ru.receipt.review.cancel_record_offline)
    expect(useReceiptQueueStore().pending).toHaveLength(1)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(view.text()).not.toContain(ru.receipt.review.cancel_record_failed)
  })

  it('«Покупки» let go of a receipt the server says is recorded: its refusal, photos and draft (MOL-169, review 1, А2)', async () => {
    recordReceipt.mockRejectedValueOnce(new ApiError(ERROR.CONFLICT, 'x'))
    const { view, router } = await render()
    useReceiptDraftsStore().setTotal(ID, parseMoney('900', 'AMD'))
    await button(view, 'Записать 2 покупки').trigger('click')
    await flushPromises()
    expect(useReceiptQueueStore().rejected).toHaveLength(1)

    const written = detail()
    receipts.mockResolvedValue({
      receipts: [{ ...written.receipt, status: 'recorded', tripId: TRIP }],
    })
    await router.replace('/purchases')
    await flushPromises()
    expect(receipts).toHaveBeenCalled()
    expect(useReceiptQueueStore().rejected).toEqual([])
    expect(keepOnly.mock.calls.at(-1)?.[0].has(ID)).toBe(false)
    expect(useReceiptDraftsStore().draftOf(ID)).toBeNull()
  })

  // MOL-222, В-1: what was «переснимите» is the review's hint, and the receipt is recorded all the same
  it('read in part: the lines against the total, «Переснять» beside, «Записать» as ever', async () => {
    const partial = detail()
    receipt.mockResolvedValue({ ...partial, receipt: { ...partial.receipt, total: amd('10000') } })
    const { view } = await render()
    const strip = view.get('.partly')
    expect(strip.text()).toContain('Прочитали не всё: строки дают')
    expect(strip.text()).toContain(ru.receipt.capture.retake)
    const record = button(view, 'Записать 2')
    expect(record.attributes('aria-disabled')).not.toBe('true')
  })

  it('read in part against a total read in one place: not shown, the lines «из примерно» it (MOL-244)', async () => {
    const partial = detail()
    receipt.mockResolvedValue({
      ...partial,
      receipt: { ...partial.receipt, total: null },
      readTotal: amd('10000'),
    })
    const { view } = await render()
    expect(view.get('.partly').text()).toContain('строки дают')
    expect(view.get('.partly').text()).toContain('из примерно')
  })

  it('read in part with no total: how many lines added up; half of them is enough', async () => {
    const one = detail()
    const first = line('ԿԱԹ', '500')
    const unsettled = { ...line('ՀԱՑ', '400'), settled: false }
    receipt.mockResolvedValue({
      ...one,
      receipt: { ...one.receipt, total: null },
      lines: [first, unsettled, unsettled],
    })
    const { view } = await render()
    expect(view.get('.partly').text()).toContain('сошлось строк — 1 из 3')
    while (mounted.length) mounted.pop()?.unmount()
    receipt.mockResolvedValue({
      ...one,
      receipt: { ...one.receipt, total: null },
      lines: [first, unsettled],
    })
    const half = await render()
    expect(half.view.find('.partly').exists()).toBe(false)
  })

  it('must not hint when the lines make up the total (am-03 and its like)', async () => {
    const { view } = await render()
    expect(view.find('.partly').exists()).toBe(false)
  })

  // MOL-222 named no cause it did not know; MOL-227, В-2: the possible ones, none of them asserted,
  // and faint print, which no retake fixes
  it('not one line found: the causes it may be, faint print among them, none asserted', async () => {
    const failed = detail({ status: 'failed' })
    receipt.mockResolvedValue({ ...failed, receipt: { ...failed.receipt, failure: 'reshoot' } })
    const { view } = await render()
    expect(view.text()).toContain(ru.receipt.failed.reshoot_title)
    expect(view.text()).toContain('Так бывает, когда чек смят, в тени или напечатан бледно')
    expect(view.text()).toContain(
      'Бледную печать переснимок не исправит — запишите покупки вручную',
    )
  })

  it('read in part: faint print needs the lines put right, not a retake (MOL-227, В-2)', async () => {
    const partial = detail()
    receipt.mockResolvedValue({ ...partial, receipt: { ...partial.receipt, total: amd('10000') } })
    const { view } = await render()
    expect(view.get('.partly').text()).toContain(
      'Если печать бледная, переснимать не нужно — поправьте строки',
    )
  })

  describe('a receipt with no items: the sum by the receipt (MOL-227)', () => {
    const noItems = (total: string | null): ReceiptDetail => {
      const one = detail()
      return {
        ...one,
        receipt: { ...one.receipt, lineCount: 0, total: total === null ? null : amd(total) },
        lines: [],
      }
    }

    it('says there is no list of items, shows the total alone and records the sum', async () => {
      receipt.mockResolvedValue(noItems('1700'))
      const { view, router } = await render()
      expect(view.get('.no-items').text()).toContain(ru.receipt.review.no_items)
      expect(view.find('.receipt-line').exists()).toBe(false)
      expect(view.text()).not.toContain(ru.receipt.review.lines)
      expect(view.text()).not.toMatch(/Разница|0 позиций/)
      const record = button(view, ru.receipt.review.record_sum)
      expect(record.attributes('aria-disabled')).not.toBe('true')
      await record.trigger('click')
      await flushPromises()
      expect(recordReceipt).toHaveBeenCalledTimes(1)
      const body = recordReceipt.mock.calls[0]?.[1]
      expect(body?.lines).toEqual([])
      expect(body?.place).toEqual({ id: PLACE })
      expect(router.currentRoute.value.name).toBe('purchase')
    })

    it('offers a retake, and says the photo goes — no line is left to stay (А5, А6)', async () => {
      receipt.mockResolvedValue(noItems('1700'))
      const { view } = await render()
      expect(view.get('.no-items').text()).toContain(ru.receipt.capture.retake)
      expect(view.get('p.note').text()).toBe(ru.receipt.review.photo_note_sum)
    })

    it('with no total read, waits for one typed: nothing is sent', async () => {
      receipt.mockResolvedValue(noItems(null))
      const { view } = await render()
      expect(view.text()).toContain(ru.receipt.review.total_missing)
      const record = button(view, ru.receipt.review.record_sum)
      expect(record.attributes('aria-disabled')).toBe('true')
      await record.trigger('click')
      await flushPromises()
      expect(recordReceipt).not.toHaveBeenCalled()
    })

    it('with the total typed, records it as the receipt’s total', async () => {
      receipt.mockResolvedValue(noItems(null))
      const { view } = await render()
      useReceiptDraftsStore().setTotal(ID, amd('1800'))
      await flushPromises()
      const record = button(view, ru.receipt.review.record_sum)
      expect(record.attributes('aria-disabled')).not.toBe('true')
      await record.trigger('click')
      await flushPromises()
      expect(recordReceipt.mock.calls[0]?.[1].total).toEqual(amd('1800'))
    })

    it('with no place read, asks for it and names the sum on the sheet’s action', async () => {
      const one = noItems('1700')
      receipt.mockResolvedValue({ ...one, receipt: { ...one.receipt, place: null } })
      const { view } = await render()
      await button(view, ru.receipt.review.record_sum).trigger('click')
      await flushPromises()
      expect(recordReceipt).not.toHaveBeenCalled()
      expect(sheet()?.textContent).toContain(ru.receipt.review.record_sum)
    })
  })

  it('«Отправить чек разработчику» hands the photos of this phone to the sheet, seen there (В-2)', async () => {
    const photo = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
    shelfParts.mockResolvedValue([photo])
    const { view } = await render()
    await button(view, ru.receipt.review.to_developer).trigger('click')
    const sheet = useFeedbackSheetStore()
    expect(sheet.shown).toBe(true)
    expect(sheet.entry).toEqual({ from: 'receipt' })
    expect(sheet.takePhotos()).toEqual([photo])
  })

  it('with no photo on this phone there is nothing to send: no button (В-2)', async () => {
    receipt.mockResolvedValue(detail({ status: 'failed' }))
    const { view } = await render()
    expect(view.text()).not.toContain(ru.receipt.review.to_developer)
  })

  it('not read, after a move to Georgia: a record by hand, no retake, and the words say so (MOL-109, Б3)', async () => {
    receipt.mockResolvedValue(detail({ status: 'failed' }))
    const { view } = await render({ country: 'GE', city: 'Тбилиси' })
    expect(view.text()).toContain(ru.receipt.failed.manual_body)
    expect(view.text()).not.toContain(ru.receipt.failed.body)
    const dock = view.get('.dock')
    expect(dock.text()).toContain(ru.purchases.manual)
    expect(dock.text()).not.toContain(ru.receipt.capture.retake)
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

describe('ReceiptView of a receipt by its link (MOL-232)', () => {
  const rsd = (value: string) => parseMoney(value, 'RSD')

  function serbian(over: Partial<ReceiptDetail['receipt']> = {}): ReceiptDetail {
    const base = detail({ place: false })
    return {
      ...base,
      receipt: {
        ...base.receipt,
        parts: 0,
        received: 0,
        country: 'RS',
        header: {
          tin: '100000009',
          date: '2025-07-18',
          time: '08:56',
          receiptNo: 'TESTAAAA-TESTBBBB-1',
          shop: 'RODA MEGAMARKET 463',
        },
        total: rsd('486.37'),
        ...over,
      },
      lines: [
        {
          ...line('SECER KRISTAL 1KG SUNOKO KOM', '189.98'),
          price: rsd('94.99'),
          sum: rsd('189.98'),
          amount: rsd('189.98'),
          quantity: parseQuantity('2', 'piece'),
          itemId: null,
          itemName: null,
          match: 'new',
        },
      ],
    }
  }

  beforeEach(() => {
    localStorage.clear()
    receipt.mockReset()
    receipts.mockReset()
    receipts.mockResolvedValue({ receipts: [] })
    shelfParts.mockReset()
    shelfParts.mockResolvedValue([])
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })
  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('says its lines are the tax office’s, and nothing of a photo or of a retake', async () => {
    receipt.mockResolvedValue(serbian())
    const { view } = await render({ country: 'RS', city: 'Белград' })
    expect(view.text()).toContain(ru.receipt.review.from_tax_office)
    expect(view.text()).not.toContain(ru.receipt.review.photo_note)
    expect(view.text()).not.toContain(ru.receipt.capture.retake)
    // the new item is named by the line less its unit word
    expect(view.text()).toContain('Secer kristal 1kg sunoko')
  })

  it('names the seller’s ПИБ, and proposes the shop the tax office names as a new place', async () => {
    receipt.mockResolvedValue(
      serbian({
        place: { id: PLACE, name: 'RODA MEGAMARKET 463', city: 'Белград', tin: '100000009' },
      }),
    )
    const { view } = await render({ country: 'RS', city: 'Белград' })
    expect(view.text()).toContain('ПИБ 100000009')
    expect(view.text()).not.toContain('ИНН')
    view.unmount()
    mounted.pop()
    document.body.innerHTML = ''

    receipt.mockResolvedValue(serbian())
    const second = await render({ country: 'RS', city: 'Белград' })
    expect(second.view.findComponent(ReceiptPlaceSheet).props('proposed')).toBe(
      'RODA MEGAMARKET 463',
    )
  })

  it('says the tax office never showed it, with a record by hand and no retake', async () => {
    receipt.mockResolvedValue(serbian({ status: 'failed', failure: 'missing' }))
    const { view } = await render({ country: 'RS', city: 'Белград' })
    expect(view.text()).toContain(ru.receipt.failed.link.missing_title)
    expect(view.text()).not.toContain(ru.receipt.failed.photos)
    expect(view.text()).not.toContain(ru.receipt.capture.retake)
  })

  it('takes no retake for a receipt by its link even where the camera is the person’s', async () => {
    receipt.mockResolvedValue(serbian({ status: 'failed', failure: 'invalid' }))
    const { view } = await render()
    expect(view.text()).toContain(ru.receipt.failed.link.invalid_title)
    expect(view.findComponent(CaptureSheet).exists()).toBe(false)
    expect(view.text()).not.toContain(ru.receipt.capture.retake)
  })
})
