import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { ActorView, ReceiptsAccess } from '@molvia/model'
import { useAccessKeptFresh } from '@/composables/useReceiptsAccess'
import { useActorStore } from '@/stores/actor'

const me = vi.fn()
vi.mock('@/api', () => ({ api: { me: (...args: unknown[]) => me(...args) } }))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GEORGIA: ActorView = {
  id: OWNER,
  country: 'GE',
  city: 'Тбилиси',
  spendCurrency: 'GEL',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-16T10:00:00Z'),
  updatedAt: new Date('2026-09-16T10:00:00Z'),
}
const OPEN: ReceiptsAccess = {
  until: null,
  ended: null,
  trialLeft: 6,
  trialOf: 10,
  month: '2026-11-01',
  read: 4,
  limit: 100,
}

const views: VueWrapper[] = []

/** A screen that holds the camera, with the store as the live app keeps it: `ready`, the last `/actors/me`. */
async function screen(actor: ActorView, readByScreen = false): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useActorStore()
  store.id = actor.id
  store.actor = actor
  store.state = 'ready'
  const view = mount(
    defineComponent({
      setup() {
        useAccessKeptFresh({ readByScreen })
        return () => null
      },
    }),
    { global: { plugins: [pinia] } },
  )
  views.push(view)
  await flushPromises()
  return view
}

function cameBack(): void {
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  me.mockReset()
  vi.useFakeTimers({ now: new Date('2026-11-19T12:00:00Z'), toFake: ['Date', 'setTimeout'] })
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
})

describe('where the person stands, kept fresh by the screen that holds the camera (MOL-276)', () => {
  it('asks again as the app comes back into view', async () => {
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: OPEN })
    await screen({ ...GEORGIA, receiptsAccess: OPEN })
    expect(me).not.toHaveBeenCalled()
    cameBack()
    await flushPromises()
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('asks again at midnight with the screen in view (adversarial А3)', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 30, 23, 58), toFake: ['Date', 'setTimeout'] })
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    await screen({ ...GEORGIA, receiptsAccess: OPEN })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('asks as the screen comes where the figures are of a month before the phone’s (Б2), and not of its own', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-01T08:00:00Z'), toFake: ['Date', 'setTimeout'] })
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    await screen({ ...GEORGIA, receiptsAccess: OPEN })
    expect(me).toHaveBeenCalledTimes(1)

    me.mockClear()
    await screen({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    expect(me).not.toHaveBeenCalled()
  })

  it('asks once a paid reading runs out with the screen in view (Б3)', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-19T09:58:00Z'), toFake: ['Date', 'setTimeout'] })
    const until = new Date('2026-12-19T10:00:00Z')
    const paid = { ...OPEN, month: '2026-12-01', until }
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...paid, until: null, ended: until } })
    await screen({ ...GEORGIA, receiptsAccess: paid })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(me).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('asks once, never every two seconds, where the phone’s clock runs ahead of the server’s (adversarial В1)', async () => {
    // the phone says 10:00, the server 09:00: for it the grant goes on, and every answer brings its `until` anew
    vi.useFakeTimers({ now: new Date('2026-12-19T10:00:00Z'), toFake: ['Date', 'setTimeout'] })
    const paid = () => ({ ...OPEN, month: '2026-12-01', until: new Date('2026-12-19T10:00:00Z') })
    me.mockImplementation(() => Promise.resolve({ ...GEORGIA, receiptsAccess: paid() }))
    await screen({ ...GEORGIA, receiptsAccess: paid() })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('arms the grant’s end by the answer at midnight, the screen open more than a day before it (adversarial Г1)', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-18T08:00:00Z'), toFake: ['Date', 'setTimeout'] })
    const until = new Date('2026-12-19T10:00:00Z')
    const asked: number[] = []
    // the server's word by its clock, the same as the phone's: the grant goes on until 10:00
    me.mockImplementation(() => {
      asked.push(Date.now())
      return Promise.resolve({
        ...GEORGIA,
        receiptsAccess:
          Date.now() < until.getTime()
            ? { ...OPEN, month: '2026-12-01', until: new Date(until) }
            : { ...OPEN, month: '2026-12-01', trialLeft: 0, ended: new Date(until) },
      })
    })
    await screen({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01', until } })
    await vi.advanceTimersByTimeAsync(26 * 60 * 60_000 + 5 * 60_000)
    expect(asked.filter((at) => at >= until.getTime())).toHaveLength(1)
    expect(useActorStore().actor?.receiptsAccess?.ended).toEqual(until)
  })

  it('asks once about a grant the phone’s clock finds over, every answer after it saying it goes on (В1, Г1)', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-19T10:00:00Z'), toFake: ['Date', 'setTimeout'] })
    const paid = () => ({ ...OPEN, month: '2026-12-01', until: new Date('2026-12-19T10:00:00Z') })
    me.mockImplementation(() => Promise.resolve({ ...GEORGIA, receiptsAccess: paid() }))
    await screen({ ...GEORGIA, receiptsAccess: paid() })
    await vi.advanceTimersByTimeAsync(60_000)
    cameBack()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    // one for the grant's end, one for the return — and no timer armed again by either answer
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('must not ask where receipts are not read off the photo: Serbia’s are their link', async () => {
    await screen({
      ...GEORGIA,
      country: 'RS',
      city: 'Белград',
      spendCurrency: 'RSD',
      receiptsAccess: OPEN,
    })
    cameBack()
    await flushPromises()
    expect(me).not.toHaveBeenCalled()
  })
})

describe('the settings, whose form reads `/actors/me` itself (review №12)', () => {
  it('leave the return and the coming to the form, and keep the midnight', async () => {
    vi.useFakeTimers({ now: new Date(2026, 11, 1, 23, 58), toFake: ['Date', 'setTimeout'] })
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    await screen({ ...GEORGIA, receiptsAccess: OPEN }, true)
    cameBack()
    await flushPromises()
    expect(me).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })
})
