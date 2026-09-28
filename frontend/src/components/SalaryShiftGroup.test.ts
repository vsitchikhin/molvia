import { mount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { SalaryShift } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { useActorStore } from '@/stores/actor'
import SalaryShiftGroup from './SalaryShiftGroup.vue'

const read = vi.fn<() => Promise<SalaryShift>>()
const choose = vi.fn<(day: number | null) => Promise<SalaryShift>>()
vi.mock('@/api', () => ({
  api: {
    salaryShift: () => read(),
    chooseSalaryShift: (day: number | null) => choose(day),
  },
}))

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
  const view = mount(SalaryShiftGroup, { global: { plugins: [pinia, createAppI18n('en')] } })
  views.push(view)
  await flushPromises()
  return view
}

function switchOf(view: VueWrapper) {
  return view.get<HTMLInputElement>('input[role="switch"]')
}

beforeEach(() => {
  vi.restoreAllMocks()
  read.mockReset()
  choose.mockReset()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  read.mockResolvedValue({ day: null })
  choose.mockImplementation((day) => Promise.resolve({ day }))
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
})

it('is off by default, with no day to choose', async () => {
  const view = await render()
  expect(switchOf(view).element.checked).toBe(false)
  expect(switchOf(view).attributes('disabled')).toBeUndefined()
  expect(view.find('select').exists()).toBe(false)
  expect(view.text()).toContain(en.settings.salary_shift.hint)
})

it('turns on at the 25th on the tap, and saves at once (В-5)', async () => {
  const view = await render()
  await switchOf(view).setValue(true)
  await flushPromises()
  expect(choose).toHaveBeenCalledWith(25)
  expect(view.get('select').element.value).toBe('25')
})

it('moves the day by the native select, and turns off with null', async () => {
  read.mockResolvedValue({ day: 25 })
  const view = await render()
  expect(switchOf(view).element.checked).toBe(true)
  await view.get('select').setValue('28')
  await flushPromises()
  expect(choose).toHaveBeenLastCalledWith(28)
  await switchOf(view).setValue(false)
  await flushPromises()
  expect(choose).toHaveBeenLastCalledWith(null)
  expect(view.find('select').exists()).toBe(false)
})

it('puts the switch back where the server holds it when the answer does not come', async () => {
  choose.mockRejectedValue(new TypeError('network'))
  const view = await render()
  await switchOf(view).setValue(true)
  await flushPromises()
  expect(switchOf(view).element.checked).toBe(false)
  expect(view.get('[role="alert"]').text()).toContain(en.settings.salary_shift.save_failed)
})

it('waits offline: the switch is inactive and says why', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  read.mockRejectedValue(new TypeError('network'))
  const view = await render()
  expect(switchOf(view).attributes('disabled')).toBeDefined()
  expect(view.text()).toContain(en.settings.salary_shift.offline)
  expect(view.text()).not.toContain(en.state.retry)
})

it('offers «Try again» after a server failure, and reads again on it', async () => {
  read.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
  const view = await render()
  expect(view.text()).toContain(en.settings.salary_shift.load_error)
  read.mockResolvedValue({ day: 25 })
  await view.get('button').trigger('click')
  await flushPromises()
  expect(switchOf(view).element.checked).toBe(true)
  expect(view.text()).not.toContain(en.settings.salary_shift.load_error)
})
