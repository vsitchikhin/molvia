import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import type { PaymentStatus } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import ru from '@/i18n/ru.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { PAY_DONE_ASKS, PAY_DONE_ASK_MS } from '@/bankPage'
import PayDoneView from './PayDoneView.vue'

const status = vi.fn<(id: string) => Promise<PaymentStatus>>()
vi.mock('@/api', () => ({ api: { paymentStatus: (id: string) => status(id) } }))

const PAYMENT = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const PAID: PaymentStatus = {
  state: 'paid',
  tariff: 'receipts',
  amount: { minor: 77_000n, currency: 'AMD' },
  access: { shared: null, receipts: new Date('2026-12-21T12:00:00Z') },
}

const views: VueWrapper[] = []
async function render(path = `/pay/done/${PAYMENT}?orderID=1042&resposneCode=00`) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(PayDoneView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('ru')] },
  })
  views.push(view)
  await flushPromises()
  return { view, router }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-21T12:00:00Z') })
  status.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the page the bank sends back to (MOL-277, requirement 5)', () => {
  it('asks the server of its own payment by the path, never believing the bank’s query, and says what opened', async () => {
    status.mockResolvedValue(PAID)
    const { view } = await render()

    expect(status).toHaveBeenCalledWith(PAYMENT)
    expect(view.text()).toContain(ru.pay.done.paid.title)
    expect(view.text()).toContain('Распознавание чеков открыто до 21 декабря.')
  })

  it('says the bank has not answered yet, and asks again every five seconds for a minute', async () => {
    status.mockResolvedValue({ ...PAID, state: 'created' })
    const { view } = await render()
    expect(view.text()).toContain(ru.pay.done.waiting.title)

    for (let ask = 1; ask < PAY_DONE_ASKS + 3; ask += 1) {
      await vi.advanceTimersByTimeAsync(PAY_DONE_ASK_MS)
    }
    expect(status).toHaveBeenCalledTimes(PAY_DONE_ASKS)

    status.mockResolvedValue(PAID)
    await vi.advanceTimersByTimeAsync(PAY_DONE_ASK_MS)
    expect(view.text()).toContain(ru.pay.done.waiting.title)
  })

  it('turns to «paid» when a later ask finds it', async () => {
    status.mockResolvedValueOnce({ ...PAID, state: 'created' }).mockResolvedValue(PAID)
    const { view } = await render()
    await vi.advanceTimersByTimeAsync(PAY_DONE_ASK_MS)
    expect(view.text()).toContain(ru.pay.done.paid.title)
  })

  it('a declined or abandoned payment charged nothing, and offers the screen of payment again', async () => {
    for (const state of ['declined', 'abandoned'] as const) {
      status.mockResolvedValue({ ...PAID, state })
      const { view, router } = await render()
      const replace = vi.spyOn(router, 'replace')
      expect(view.text()).toContain(ru.pay.done.failed.body)
      const again = [...document.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === ru.pay.done.failed.again,
      )
      expect(again).toBeDefined()
      again?.click()
      // out of the return page for good: the bank's page and this one are behind
      expect(replace).toHaveBeenCalledWith({ name: 'pay' })
      for (const shown of views.splice(0)) shown.unmount()
    }
  })

  it('someone else’s, a missing one and a malformed address are «no such payment», never an error', async () => {
    status.mockRejectedValue(new ApiError('error.not_found', undefined, true, 404))
    expect((await render()).view.text()).toContain(ru.pay.done.missing.title)
    status.mockClear()
    expect((await render('/pay/done/nope')).view.text()).toContain(ru.pay.done.missing.title)
    expect(status).not.toHaveBeenCalled()
  })

  it('decides offline or error after the failure', async () => {
    status.mockRejectedValue(new TypeError('Failed to fetch'))
    expect((await render()).view.text()).toContain(ru.pay.done.error.title)
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect((await render()).view.text()).toContain(ru.pay.done.offline.title)
  })
})
