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
import { createAppI18n } from '@/i18n'
import { useActorStore } from '@/stores/actor'
import { hearFf } from '@/stores/ff'
import { useFeedbackSheetStore } from '@/stores/feedbackSheet'

vi.mock('@/api', () => ({ api: {} }))

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
const OPEN: ReceiptsAccess = {
  until: null,
  trialLeft: 6,
  trialOf: 10,
  month: '2026-11-01',
  read: 4,
  limit: 100,
}
const TRIAL_OVER: ReceiptsAccess = { ...OPEN, trialLeft: 0, read: 10 }
const HUNDRED: ReceiptsAccess = { ...OPEN, until: new Date('2026-12-18T00:00:00Z'), read: 100 }

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
async function render(actor: ActorView, country: ReceiptCountry = 'AM') {
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
  return view
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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  hearFf(new Set())
  begin.mockClear()
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
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
    const view = await render(
      {
        ...ARMENIA,
        country: 'GE',
        city: 'Тбилиси',
        spendCurrency: 'GEL',
        receiptsAccess: TRIAL_OVER,
      },
      'GE',
    )
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
    camera(view).vm.$emit('update:open', false)
    camera(view).props('onClosed')?.()
    await flushPromises()

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

  it('«Написать разработчику» opens the developer’s sheet once this one is away', async () => {
    hearFf(new Set(['payments']))
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    const feedback = useFeedbackSheetStore()
    expect(feedback.shown).toBe(false)
    await choose(view, 'developer')
    expect(feedback.shown).toBe(true)
    expect(begin).not.toHaveBeenCalled()
  })

  it('is busy while its sheet is up', async () => {
    const view = await render({ ...ARMENIA, receiptsAccess: TRIAL_OVER })
    await tap(view)
    expect(view.emitted('busy')?.at(-1)).toEqual([true])
    await choose(view, 'developer')
    expect(view.emitted('busy')?.at(-1)).toEqual([false])
  })
})
