import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { RemindersSetting } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { useActorStore } from '@/stores/actor'
import RemindersGroup from './RemindersGroup.vue'

const read = vi.fn<() => Promise<RemindersSetting>>()
const choose = vi.fn<(on: boolean) => Promise<RemindersSetting>>()
vi.mock('@/api', () => ({
  api: {
    remindersSetting: () => read(),
    chooseReminders: (on: boolean) => choose(on),
  },
}))

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const view = mount(RemindersGroup, { global: { plugins: [pinia, createAppI18n('en')] } })
  views.push(view)
  await flushPromises()
  return view
}

function switchOf(view: VueWrapper) {
  return view.get<HTMLInputElement>('input[role="switch"]')
}

function describedBy(view: VueWrapper): string[] {
  const ids = (switchOf(view).attributes('aria-describedby') ?? '').split(' ')
  return ids.map((id) => view.find(`[id="${id}"]`).text())
}

beforeEach(() => {
  vi.restoreAllMocks()
  read.mockReset()
  choose.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  read.mockResolvedValue({ off: null })
  choose.mockImplementation((on) => Promise.resolve({ off: on ? null : 'chosen' }))
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
})

it('is on by default and says how the reminders work', async () => {
  const view = await render()
  expect(switchOf(view).element.checked).toBe(true)
  expect(switchOf(view).attributes('aria-disabled')).toBeUndefined()
  expect(view.text()).toContain(en.settings.reminders.hint)
  expect(view.text()).not.toContain(en.settings.reminders.blocked)
})

it('waits for the server before it can be moved, showing «on» as nearly everyone has it (review №1)', async () => {
  read.mockReturnValue(new Promise(() => undefined))
  const view = await render()
  expect(switchOf(view).attributes('aria-disabled')).toBe('true')
  expect(switchOf(view).element.checked).toBe(true)
  expect(view.text()).not.toContain(en.settings.reminders.blocked)
})

it('an answer read moves nothing: the switch is not live until a finger moved it', async () => {
  read.mockResolvedValue({ off: 'chosen' })
  const view = await render()
  expect(switchOf(view).element.checked).toBe(false)
  expect(view.get('.switch').classes()).not.toContain('live')
})

it('turns off on the tap and saves at once; on again the same way', async () => {
  const view = await render()
  await switchOf(view).setValue(false)
  await flushPromises()
  expect(choose).toHaveBeenLastCalledWith(false)
  expect(switchOf(view).element.checked).toBe(false)
  await switchOf(view).setValue(true)
  await flushPromises()
  expect(choose).toHaveBeenLastCalledWith(true)
  expect(switchOf(view).element.checked).toBe(true)
})

it('off by a blocked bot: says so, and the switch is inactive — only an unblock brings them back (В-5)', async () => {
  read.mockResolvedValue({ off: 'blocked' })
  const view = await render()
  expect(switchOf(view).element.checked).toBe(false)
  expect(switchOf(view).attributes('aria-disabled')).toBe('true')
  expect(view.text()).toContain(en.settings.reminders.blocked)
  expect(describedBy(view)).toContain(en.settings.reminders.blocked)
})

it('off by the person: no word about a block', async () => {
  read.mockResolvedValue({ off: 'chosen' })
  const view = await render()
  expect(switchOf(view).element.checked).toBe(false)
  expect(view.text()).not.toContain(en.settings.reminders.blocked)
})

it('puts the switch back where the server holds it when the answer does not come', async () => {
  choose.mockRejectedValue(new TypeError('network'))
  const view = await render()
  await switchOf(view).setValue(false)
  await flushPromises()
  expect(switchOf(view).element.checked).toBe(true)
  expect(view.get('[role="alert"]').text()).toContain(en.settings.tap.save_failed)
})

it('waits offline: the switch is inactive and says why, to a screen reader too', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  read.mockRejectedValue(new TypeError('network'))
  const view = await render()
  expect(switchOf(view).attributes('aria-disabled')).toBe('true')
  expect(view.text()).toContain(en.settings.tap.offline)
  expect(view.text()).not.toContain(en.state.retry)
  expect(describedBy(view)).toContain(en.settings.tap.offline)
})

it('offers «Try again» after a server failure, and reads again on it', async () => {
  read.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
  const view = await render()
  expect(view.text()).toContain(en.settings.tap.load_error)
  read.mockResolvedValue({ off: 'chosen' })
  await view.get('button').trigger('click')
  await flushPromises()
  expect(switchOf(view).element.checked).toBe(false)
  expect(view.text()).not.toContain(en.settings.tap.load_error)
})
