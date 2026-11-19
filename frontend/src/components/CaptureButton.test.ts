/* eslint-disable vue/one-component-per-file -- the sheets' stubs, not components of the app */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import type { PropType } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { ActorView, ReceiptCountry, ReceiptsAccess } from '@molvia/model'
import CaptureButton from '@/components/CaptureButton.vue'
import RealManualEntryButton from '@/components/ManualEntryButton.vue'
import { createAppI18n } from '@/i18n'
import { useActorStore } from '@/stores/actor'
import { hearFf } from '@/stores/ff'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'

const me = vi.fn()
vi.mock('@/api', () => ({ api: { me: (...args: unknown[]) => me(...args) } }))

const OWNER = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const ARMENIA: ActorView = {
  id: OWNER,
  country: 'AM',
  city: 'Гюмри',
  spendCurrency: 'AMD',
  incomeCurrency: 'RUB',
  createdAt: new Date('2026-09-16T10:00:00Z'),
  updatedAt: new Date('2026-09-16T10:00:00Z'),
}
const GEORGIA: ActorView = { ...ARMENIA, country: 'GE', city: 'Тбилиси', spendCurrency: 'GEL' }
const OPEN: ReceiptsAccess = {
  until: null,
  ended: null,
  trialLeft: 6,
  trialOf: 10,
  month: '2026-11-01',
  read: 4,
  limit: 100,
}
const TRIAL_OVER: ReceiptsAccess = { ...OPEN, trialLeft: 0, read: 10 }
const HUNDRED: ReceiptsAccess = { ...OPEN, until: new Date('2026-12-18T00:00:00Z'), read: 100 }
/** The developer opened the reading by hand — what the sheet promises. */
const GRANTED: ReceiptsAccess = { ...TRIAL_OVER, until: new Date('2026-12-19T10:00:00Z') }
/** That grant run out: none paid, sixty read this month — no trial gives that. */
const LAPSED: ReceiptsAccess = {
  ...TRIAL_OVER,
  ended: new Date('2026-12-19T10:00:00Z'),
  month: '2026-12-01',
  read: 60,
}

/** A sheet as the button sees it: its props, and nothing drawn. */
const closer = { type: Function as PropType<() => void>, default: undefined }
const CaptureSheet = defineComponent({
  name: 'CaptureSheet',
  props: { open: Boolean, country: { type: String, default: '' }, onClosed: closer },
  emits: ['update:open'],
  setup: () => () => null,
})
const LinkReceiptSheet = defineComponent({
  name: 'LinkReceiptSheet',
  props: { open: Boolean, onClosed: closer },
  emits: ['update:open'],
  setup: () => () => null,
})
const ReceiptsClosedSheet = defineComponent({
  name: 'ReceiptsClosedSheet',
  props: {
    open: Boolean,
    reason: { type: String, default: '' },
    access: { type: Object, default: null },
    othersRead: Boolean,
    onClosed: closer,
  },
  emits: ['update:open', 'choose'],
  setup: () => () => null,
})
const begin = vi.fn()
const ManualEntryButton = defineComponent({
  name: 'ManualEntryButton',
  props: { bare: Boolean },
  setup(_props, { expose }) {
    expose({ begin })
    return () => null
  },
})

const views: VueWrapper[] = []
async function render(actor: ActorView, country: ReceiptCountry = 'AM'): Promise<VueWrapper> {
  return (await rendered(actor, country)).view
}

async function rendered(actor: ActorView, country: ReceiptCountry = 'AM') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useActorStore()
  store.id = actor.id
  store.actor = actor
  store.state = 'ready'
  const blank = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'advice', component: blank },
      { path: '/purchases', name: 'purchases', component: blank },
    ],
  })
  await router.push('/purchases')
  const view = mount(CaptureButton, {
    props: { country },
    global: {
      plugins: [router, pinia, createAppI18n('ru')],
      stubs: { CaptureSheet, LinkReceiptSheet, ReceiptsClosedSheet, ManualEntryButton },
    },
  })
  views.push(view)
  return { view, store }
}

/** An answer of `/actors/me` landing while the screen is open (`verify` as the app comes back). */
async function answered(store: ReturnType<typeof useActorStore>, access: ReceiptsAccess) {
  store.actor = { ...(store.actor as ActorView), receiptsAccess: access }
  await flushPromises()
}

async function tap(view: VueWrapper): Promise<void> {
  await view.get('button').trigger('click')
  await flushPromises()
}

/** The sheet put away with one of its ways chosen, as `BottomSheet` tells it once it is down. */
async function choose(view: VueWrapper, way: 'photo' | 'manual' | 'developer'): Promise<void> {
  const sheet = view.findComponent(ReceiptsClosedSheet)
  sheet.vm.$emit('choose', way)
  await flushPromises()
  sheet.props('onClosed')?.()
  await flushPromises()
}

const closedSheet = (view: VueWrapper) => view.findComponent(ReceiptsClosedSheet)
const camera = (view: VueWrapper) => view.findComponent(CaptureSheet)

/** The camera's sheet put away with no photo, as `BottomSheet` tells it once it is down. */
async function closeCamera(view: VueWrapper): Promise<void> {
  camera(view).vm.$emit('update:open', false)
  camera(view).props('onClosed')?.()
  await flushPromises()
}

beforeEach(() => {
  // one clock the test sets: the figures' month is the phone's, and no grant ends within the day
  vi.useFakeTimers({ now: new Date('2026-11-19T12:00:00Z'), toFake: ['Date'] })
  me.mockReset()
  localStorage.clear()
  sessionStorage.clear()
  hearFf(new Set())
  begin.mockClear()
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  vi.useRealTimers()
})

describe('«Сфотографировать чек» where the model reads no more (MOL-276)', () => {
  it('opens the camera while the trial lasts', async () => {
    const view = await render({ ...ARMENIA, receiptsAccess: { ...OPEN, trialLeft: 1 } })
    await tap(view)
    expect(camera(view).exists()).toBe(true)
    expect(closedSheet(view).exists()).toBe(false)
  })

  it('opens the camera where the server has not said where the person stands', async () => {
    const view = await render(ARMENIA)
    await tap(view)
    expect(camera(view).exists()).toBe(true)
    expect(closedSheet(view).exists()).toBe(false)
  })

  it('stands the sheet first once the trial is spent, the camera a way on while Tesseract reads', async () => {
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    expect(camera(view).exists()).toBe(false)
    expect(closedSheet(view).props()).toMatchObject({
      open: true,
      reason: 'trial',
      othersRead: true,
    })

    await choose(view, 'photo')
    expect(closedSheet(view).exists()).toBe(false)
    expect(camera(view).props('open')).toBe(true)
  })

  it('says the trial’s end once on this phone, while payment is not open', async () => {
    const first = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(first)
    await choose(first, 'photo')

    // Another launch of the app, the same owner: the camera at once.
    const again = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(again)
    expect(closedSheet(again).exists()).toBe(false)
    expect(camera(again).exists()).toBe(true)
  })

  it('stands at every tap once payment is open: nobody would read the receipt', async () => {
    hearFf(new Set(['payments']))
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    expect(closedSheet(view).props('othersRead')).toBe(false)
    await choose(view, 'manual')

    await tap(view)
    expect(closedSheet(view).exists()).toBe(true)
    expect(camera(view).exists()).toBe(false)
  })

  it('stands at every tap in Georgia, which no Tesseract reads, the фф off', async () => {
    const view = await render({ ...GEORGIA, receiptsAccess: TRIAL_OVER }, 'GE')
    await tap(view)
    expect(closedSheet(view).props('othersRead')).toBe(false)
    await choose(view, 'developer')
    await tap(view)
    expect(closedSheet(view).exists()).toBe(true)
  })

  it('says the month’s hundred once a month, and again in the next', async () => {
    const view = await render({ ...ARMENIA, receiptsAccess: HUNDRED })
    await tap(view)
    expect(closedSheet(view).props('reason')).toBe('month')
    await choose(view, 'photo')
    await closeCamera(view)

    await tap(view)
    expect(closedSheet(view).exists()).toBe(false)

    const december = await render({
      ...ARMENIA,
      receiptsAccess: { ...HUNDRED, month: '2026-12-01' },
    })
    await tap(december)
    expect(closedSheet(december).exists()).toBe(true)
  })

  it('never stands before a Serbian receipt, read by its link and by no model', async () => {
    const view = await render(
      {
        ...ARMENIA,
        country: 'RS',
        city: 'Белград',
        spendCurrency: 'RSD',
        receiptsAccess: TRIAL_OVER,
      },
      'RS',
    )
    await tap(view)
    expect(closedSheet(view).exists()).toBe(false)
    expect(view.findComponent(LinkReceiptSheet).exists()).toBe(true)
  })

  it('«Записать вручную» begins the strip’s own way in once the sheet is away', async () => {
    hearFf(new Set(['payments']))
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    await choose(view, 'manual')
    expect(view.findComponent(ManualEntryButton).props('bare')).toBe(true)
    expect(begin).toHaveBeenCalledTimes(1)
    expect(camera(view).exists()).toBe(false)
  })

  it('«Написать разработчику» opens the developer’s sheet once this one is away, named as its own way in', async () => {
    hearFf(new Set(['payments']))
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    const feedback = useFeedbackSheetStore()
    expect(feedback.shown).toBe(false)
    await choose(view, 'developer')
    expect(feedback.shown).toBe(true)
    // never «the settings» it is not (review №5)
    expect(feedback.entry).toEqual({ from: 'receipts-closed' })
    expect(begin).not.toHaveBeenCalled()
  })

  it('is busy while its sheet is up', async () => {
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    expect(view.emitted('busy')?.at(-1)).toEqual([true])
    await choose(view, 'developer')
    expect(view.emitted('busy')?.at(-1)).toEqual([false])
  })

  it('stays up with its words when a fresh answer opens the reading under it, and goes only as it is put away (adversarial А1)', async () => {
    const { view, store } = await rendered({ ...GEORGIA, receiptsAccess: TRIAL_OVER }, 'GE')
    await tap(view)
    await answered(store, GRANTED)
    expect(closedSheet(view).props()).toMatchObject({ open: true, reason: 'trial' })

    await choose(view, 'developer')
    expect(closedSheet(view).exists()).toBe(false)
    expect(view.emitted('busy')?.at(-1)).toEqual([false])
  })

  it('never rises by itself when the reading closes again later, untapped (adversarial А1)', async () => {
    const { view, store } = await rendered({ ...GEORGIA, receiptsAccess: TRIAL_OVER }, 'GE')
    await tap(view)
    await choose(view, 'developer')
    await answered(store, GRANTED)
    await answered(store, HUNDRED)
    expect(closedSheet(view).exists()).toBe(false)
  })

  it('says a paid reading’s end once for each grant while Tesseract reads, the trial’s end said before (adversarial А2)', async () => {
    const { view, store } = await rendered({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    await choose(view, 'photo')
    await closeCamera(view)

    await answered(store, GRANTED)
    await answered(store, LAPSED)
    await tap(view)
    expect(closedSheet(view).props()).toMatchObject({ reason: 'ended', othersRead: true })
    await choose(view, 'photo')
    await closeCamera(view)

    // the same grant's end: the camera at once
    await tap(view)
    expect(closedSheet(view).exists()).toBe(false)
    await closeCamera(view)

    // another grant run out is told again
    await answered(store, { ...LAPSED, ended: new Date('2027-01-19T10:00:00Z') })
    await tap(view)
    expect(closedSheet(view).props('reason')).toBe('ended')
  })

  it('marks the sheet told only when it is shown, never by being asked (review №1)', async () => {
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    expect(localStorage.getItem(`molvia.receipts-told.${OWNER}`)).toBeNull()
    await tap(view)
    expect(JSON.parse(localStorage.getItem(`molvia.receipts-told.${OWNER}`) ?? '{}')).toEqual({
      trial: true,
    })
  })

  it('asks where the person stands again at midnight with the screen in view (adversarial А3)', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 30, 23, 58), toFake: ['Date', 'setTimeout'] })
    me.mockResolvedValue({
      ...GEORGIA,
      receiptsByModel: true,
      receiptsAccess: { ...HUNDRED, month: '2026-12-01', read: 0 },
    })
    const view = await render({ ...GEORGIA, receiptsByModel: false, receiptsAccess: HUNDRED }, 'GE')
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await flushPromises()
    expect(me).toHaveBeenCalledTimes(1)

    await tap(view)
    expect(closedSheet(view).exists()).toBe(false)
    expect(camera(view).props('open')).toBe(true)
  })

  it('asks again as it comes, where the figures are of a month before the phone’s — put away over midnight elsewhere (Б2)', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-01T08:00:00Z'), toFake: ['Date'] })
    me.mockResolvedValue({
      ...GEORGIA,
      receiptsByModel: true,
      receiptsAccess: { ...HUNDRED, month: '2026-12-01', read: 0 },
    })
    const view = await render({ ...GEORGIA, receiptsByModel: false, receiptsAccess: HUNDRED }, 'GE')
    expect(me).toHaveBeenCalledTimes(1)

    await tap(view)
    expect(closedSheet(view).exists()).toBe(false)
    expect(camera(view).props('open')).toBe(true)
  })

  it('must not ask as it comes where the figures are of the phone’s month (Б2)', async () => {
    await render({ ...ARMENIA, receiptsAccess: HUNDRED })
    expect(me).not.toHaveBeenCalled()
  })

  it('asks again as a paid reading runs out with the screen in view (Б3)', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-19T09:58:00Z'), toFake: ['Date', 'setTimeout'] })
    const until = new Date('2026-12-19T10:00:00Z')
    me.mockResolvedValue({
      ...GEORGIA,
      receiptsByModel: false,
      receiptsAccess: { ...TRIAL_OVER, month: '2026-12-01', ended: until },
    })
    const view = await render(
      {
        ...GEORGIA,
        receiptsByModel: true,
        receiptsAccess: { ...TRIAL_OVER, month: '2026-12-01', until },
      },
      'GE',
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect(me).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(me).toHaveBeenCalledTimes(1)

    await tap(view)
    expect(closedSheet(view).props('reason')).toBe('ended')
    expect(camera(view).exists()).toBe(false)
  })

  it('«Записать вручную» bare offers `begin`, the one method the button calls (review №6)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', name: 'purchases', component: { render: () => null } }],
    })
    await router.push('/')
    const bare = mount(RealManualEntryButton, {
      props: { bare: true },
      global: { plugins: [router, pinia, createAppI18n('ru')], stubs: { BottomSheet: true } },
    })
    views.push(bare)
    expect(bare.find('button').exists()).toBe(false)
    expect(typeof (bare.vm as unknown as { begin?: unknown }).begin).toBe('function')
  })
})
