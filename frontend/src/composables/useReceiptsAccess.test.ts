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

/**
 * The clock the timers here run on (review №16): `clearTimeout` faked with `setTimeout`, or a timer the composable
 * takes back still fires on the fake clock, and a clearing broken would never be seen.
 */
function clockAt(now: Date): void {
  vi.useFakeTimers({ now, toFake: ['Date', 'setTimeout', 'clearTimeout'] })
}

function cameBack(): void {
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  me.mockReset()
  clockAt(new Date('2026-11-19T12:00:00Z'))
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
    clockAt(new Date(2026, 10, 30, 23, 58))
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    await screen({ ...GEORGIA, receiptsAccess: OPEN })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('asks as the screen comes where the figures are of a month before the phone’s (Б2), and not of its own', async () => {
    clockAt(new Date('2026-12-01T08:00:00Z'))
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    await screen({ ...GEORGIA, receiptsAccess: OPEN })
    expect(me).toHaveBeenCalledTimes(1)

    me.mockClear()
    await screen({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    expect(me).not.toHaveBeenCalled()
  })

  it('asks once a paid reading runs out with the screen in view (Б3)', async () => {
    clockAt(new Date('2026-12-19T09:58:00Z'))
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
    // the phone says 10:00, the server 09:00: for it the grant goes on, and every answer brings its `until` anew —
    // the answer to the screen's own question after the moment is believed
    clockAt(new Date('2026-12-19T10:00:00Z'))
    const paid = () => ({ ...OPEN, month: '2026-12-01', until: new Date('2026-12-19T10:00:00Z') })
    me.mockImplementation(() => Promise.resolve({ ...GEORGIA, receiptsAccess: paid() }))
    await screen({ ...GEORGIA, receiptsAccess: paid() })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })

  it('arms the grant’s end by the answer at midnight, the screen open more than a day before it (adversarial Г1)', async () => {
    clockAt(new Date('2026-12-18T08:00:00Z'))
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

  it('stops asking about a grant the phone’s clock finds over once an answer after it says it goes on (В1, Г1)', async () => {
    clockAt(new Date('2026-12-19T10:00:00Z'))
    const paid = () => ({ ...OPEN, month: '2026-12-01', until: new Date('2026-12-19T10:00:00Z') })
    me.mockImplementation(() => Promise.resolve({ ...GEORGIA, receiptsAccess: paid() }))
    await screen({ ...GEORGIA, receiptsAccess: paid() })
    await vi.advanceTimersByTimeAsync(60_000)
    cameBack()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(60_000)
    // one for the grant's end, one for the return — and no timer armed again by the answer to the return
    expect(me).toHaveBeenCalledTimes(2)
  })

  it('asks again about a grant’s end whose one ask the network lost (adversarial Д1)', async () => {
    clockAt(new Date('2026-12-19T09:58:00Z'))
    const until = new Date('2026-12-19T10:00:00Z')
    const asked: number[] = []
    me.mockImplementation(() => {
      asked.push(Date.now())
      // the ask at the grant's end is lost at the shelf, the connection said to be there
      if (asked.length === 1) return Promise.reject(new TypeError('Failed to fetch'))
      return Promise.resolve({
        ...GEORGIA,
        receiptsAccess: { ...OPEN, month: '2026-12-01', trialLeft: 0, ended: new Date(until) },
      })
    })
    await screen({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01', until } })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(asked).toEqual([until.getTime() + 2_000, until.getTime() + 7_000])
    expect(useActorStore().actor?.receiptsAccess?.ended).toEqual(until)
  })

  it('asks again where the answer after the grant’s end was to a question asked before it (adversarial Д1)', async () => {
    clockAt(new Date('2026-12-19T09:59:50Z'))
    const until = new Date('2026-12-19T10:00:00Z')
    const asked: number[] = []
    // the server answers by its clock, the phone's, as the question reaches it; the answer takes five seconds back
    me.mockImplementation(() => {
      asked.push(Date.now())
      const access =
        Date.now() < until.getTime()
          ? { ...OPEN, month: '2026-12-01', until: new Date(until) }
          : { ...OPEN, month: '2026-12-01', trialLeft: 0, ended: new Date(until) }
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({ ...GEORGIA, receiptsAccess: access })
        }, 5_000)
      })
    })
    await screen({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01', until } })
    await vi.advanceTimersByTimeAsync(8_000) // 09:59:58: the return asks, and the grant's end finds it in the air
    cameBack()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(asked.filter((at) => at >= until.getTime())).toHaveLength(1)
    expect(useActorStore().actor?.receiptsAccess?.ended).toEqual(until)
  })

  /**
   * Georgia, «Что брать» in view, a grant until 10:00, the city just moved on another phone (adversarial Е1, Е2): the
   * app comes back at 09:59:58 and `verify` asks — its answer, the server's word before the end, takes `verifyTakes`
   * to come; at 10:00:01.5 «Что брать»'s own `/actors/me`, asked before the end, is heard after it.
   */
  async function twoLateAnswers(verifyTakes: number): Promise<number[]> {
    clockAt(new Date('2026-12-19T09:59:50Z'))
    const until = new Date('2026-12-19T10:00:00Z')
    const goesOn = () => ({ ...OPEN, month: '2026-12-01', until: new Date(until) })
    const asked: number[] = []
    // the server answers by its clock, the phone's, as the question reaches it
    me.mockImplementation(() => {
      asked.push(Date.now())
      const access =
        Date.now() < until.getTime()
          ? goesOn()
          : { ...OPEN, month: '2026-12-01', trialLeft: 0, ended: new Date(until) }
      return new Promise((resolve) => {
        setTimeout(
          () => {
            resolve({ ...GEORGIA, receiptsAccess: access })
          },
          asked.length === 1 ? verifyTakes : 1_500,
        )
      })
    })
    await screen({ ...GEORGIA, receiptsAccess: goesOn() })
    await vi.advanceTimersByTimeAsync(8_000)
    cameBack()
    await vi.advanceTimersByTimeAsync(3_500)
    useActorStore().apply({ ...GEORGIA, receiptsAccess: goesOn() })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(useActorStore().actor?.receiptsAccess?.ended).toEqual(until)
    return asked.filter((at) => at >= until.getTime()).map((at) => at - until.getTime())
  }

  it('asks at the grant’s end while the return’s question is out, and two late answers take nothing away (adversarial Е1)', async () => {
    // the return's answer comes at 10:00:03, while the screen's own question is out: it waits for that one
    expect(await twoLateAnswers(5_000)).toEqual([2_000])
  })

  it('asks again where the return’s old answer comes after the screen’s own and puts the grant back (adversarial Е2)', async () => {
    // the screen's own answer says the end at 10:00:03.5; the return's, of 09:59:58, puts the grant back at 10:00:05
    // — one more question two seconds later, and the end is known again
    expect(await twoLateAnswers(7_000)).toEqual([2_000, 7_000])
  })

  it('asks again where the store let the answer about the grant’s end go, a «Сохранить» newer (adversarial Ж1)', async () => {
    clockAt(new Date('2026-12-19T09:59:00Z'))
    const until = new Date('2026-12-19T10:00:00Z')
    const asked: number[] = []
    let row = new Date('2026-12-19T09:00:00Z')
    // the server answers the grant over as it is asked, with the row as it stands then; the answer takes 1.5 s back
    me.mockImplementation(() => {
      asked.push(Date.now())
      const view = {
        ...GEORGIA,
        updatedAt: row,
        receiptsAccess: { ...OPEN, month: '2026-12-01', trialLeft: 0, ended: new Date(until) },
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(view)
        }, 1_500)
      })
    })
    await screen({
      ...GEORGIA,
      updatedAt: row,
      receiptsAccess: { ...OPEN, month: '2026-12-01', until },
    })
    await vi.advanceTimersByTimeAsync(62_500) // 10:00:02.5: the question is out, and «Сохранить» is answered
    row = new Date('2026-12-19T10:00:02.400Z')
    expect(useActorStore().apply({ ...GEORGIA, city: 'Батуми', updatedAt: row })).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(asked.map((at) => at - until.getTime())).toEqual([2_000, 8_500])
    expect(useActorStore().actor?.receiptsAccess?.ended).toEqual(until)
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
    clockAt(new Date(2026, 11, 1, 23, 58))
    me.mockResolvedValue({ ...GEORGIA, receiptsAccess: { ...OPEN, month: '2026-12-01' } })
    await screen({ ...GEORGIA, receiptsAccess: OPEN }, true)
    cameBack()
    await flushPromises()
    expect(me).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(me).toHaveBeenCalledTimes(1)
  })
})
