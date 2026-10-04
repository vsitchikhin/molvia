import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { ReceiptNoticesSetting, RemindersSetting } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import BotView from './BotView.vue'

const readReminders = vi.fn<() => Promise<RemindersSetting>>()
const chooseReminders = vi.fn<(on: boolean) => Promise<RemindersSetting>>()
const readNotices = vi.fn<() => Promise<ReceiptNoticesSetting>>()
const chooseNotices = vi.fn<(on: boolean) => Promise<ReceiptNoticesSetting>>()
vi.mock('@/api', () => ({
  api: {
    remindersSetting: () => readReminders(),
    chooseReminders: (on: boolean) => chooseReminders(on),
    receiptNoticesSetting: () => readNotices(),
    chooseReceiptNotices: (on: boolean) => chooseNotices(on),
  },
}))

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/bot')
  const view = mount(BotView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

/** The switch of the row whose label is `label`. */
function switchOf(view: VueWrapper, label: string) {
  const row = view.findAll('li').find((li) => li.text().startsWith(label))
  if (row === undefined) throw new Error(`no row «${label}»`)
  return row.get<HTMLInputElement>('input[role="switch"]')
}

const reminders = (view: VueWrapper) => switchOf(view, en.bot.reminders.label)
const receipts = (view: VueWrapper) => switchOf(view, en.bot.receipts.label)

function describedBy(view: VueWrapper, control: ReturnType<typeof switchOf>): string[] {
  const ids = (control.attributes('aria-describedby') ?? '').split(' ')
  return ids.map((id) => view.find(`[id="${id}"]`).text())
}

beforeEach(() => {
  vi.restoreAllMocks()
  for (const fake of [readReminders, chooseReminders, readNotices, chooseNotices]) fake.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  readReminders.mockResolvedValue({ off: null })
  readNotices.mockResolvedValue({ off: false })
  chooseReminders.mockImplementation((on) => Promise.resolve({ off: on ? null : 'chosen' }))
  chooseNotices.mockImplementation((on) => Promise.resolve({ off: !on }))
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  document.body.innerHTML = ''
})

describe('«Telegram bot» (MOL-129, В-2)', () => {
  it('is a switch a kind of message, both on to begin with, each saying what it does', async () => {
    const view = await render()
    expect(view.get('h2.caption').text()).toBe(en.bot.group_messages)
    expect(reminders(view).element.checked).toBe(true)
    expect(receipts(view).element.checked).toBe(true)
    expect(describedBy(view, reminders(view))).toEqual([en.bot.reminders.hint])
    expect(describedBy(view, receipts(view))).toEqual([en.bot.receipts.hint])
    expect(view.text()).not.toContain(en.bot.blocked)
  })

  it('turns «receipt read» off on the tap at its own address, the reminders untouched', async () => {
    const view = await render()
    await receipts(view).setValue(false)
    await flushPromises()
    expect(chooseNotices).toHaveBeenLastCalledWith(false)
    expect(chooseReminders).not.toHaveBeenCalled()
    expect(receipts(view).element.checked).toBe(false)
    expect(reminders(view).element.checked).toBe(true)
    await receipts(view).setValue(true)
    await flushPromises()
    expect(chooseNotices).toHaveBeenLastCalledWith(true)
    expect(receipts(view).element.checked).toBe(true)
  })

  it('turns the reminders off and on, as the settings did before (MOL-103)', async () => {
    const view = await render()
    await reminders(view).setValue(false)
    await flushPromises()
    expect(chooseReminders).toHaveBeenLastCalledWith(false)
    expect(chooseNotices).not.toHaveBeenCalled()
    expect(reminders(view).element.checked).toBe(false)
  })

  it('under a block: one line for both, both inactive, each showing the person’s choice (Р-10)', async () => {
    readReminders.mockResolvedValue({ off: 'blocked' })
    readNotices.mockResolvedValue({ off: true })
    const view = await render()
    expect(view.text()).toContain(en.bot.blocked)
    // a block never overwrites «chosen»: the reminders were on before it
    expect(reminders(view).element.checked).toBe(true)
    expect(receipts(view).element.checked).toBe(false)
    for (const control of [reminders(view), receipts(view)]) {
      expect(control.attributes('aria-disabled')).toBe('true')
      expect(describedBy(view, control)).toContain(en.bot.blocked)
    }
    await receipts(view).trigger('click')
    await flushPromises()
    expect(chooseNotices).not.toHaveBeenCalled()
  })

  it('off by the person: no word about a block', async () => {
    readReminders.mockResolvedValue({ off: 'chosen' })
    const view = await render()
    expect(reminders(view).element.checked).toBe(false)
    expect(reminders(view).attributes('aria-disabled')).toBeUndefined()
    expect(view.text()).not.toContain(en.bot.blocked)
  })

  it('puts a switch back where the server holds it when the answer does not come', async () => {
    chooseNotices.mockRejectedValue(new TypeError('network'))
    const view = await render()
    await receipts(view).setValue(false)
    await flushPromises()
    expect(receipts(view).element.checked).toBe(true)
    expect(view.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
  })
})

describe('the four states (MOL-19)', () => {
  it('draws the skeleton until both answers are in', async () => {
    readNotices.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    expect(view.text()).toContain(en.state.loading)
  })

  it('offline: no switch and no button — it loads by itself when the connection is back', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    readNotices.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.bot.offline.title)
    expect(view.find('input[role="switch"]').exists()).toBe(false)
    expect(view.text()).not.toContain(en.state.retry)
  })

  it('a server failure offers «Try again», which reads both again', async () => {
    readReminders.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const view = await render()
    expect(view.text()).toContain(en.bot.load_error.title)
    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    expect(readReminders).toHaveBeenCalledTimes(2)
    expect(reminders(view).element.checked).toBe(true)
  })

  it('loaded and then offline: the switches wait, and say why', async () => {
    const view = await render()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    for (const control of [reminders(view), receipts(view)]) {
      expect(control.attributes('aria-disabled')).toBe('true')
      expect(describedBy(view, control)).toContain(en.settings.tap.offline)
    }
  })
})
