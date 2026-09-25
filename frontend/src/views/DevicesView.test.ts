import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type { SessionView, SessionsResponse } from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import DevicesView from './DevicesView.vue'

const sessions = vi.fn<() => Promise<SessionsResponse>>()
const endSession = vi.fn<(id: string) => Promise<void>>()
vi.mock('@/api', () => ({
  api: {
    sessions: () => sessions(),
    endSession: (id: string) => endSession(id),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const CURRENT = 'b1b1b1b1-1111-4111-8111-111111111111'
const LAPTOP = 'c2c2c2c2-2222-4222-8222-222222222222'

function session(patch: Partial<SessionView>): SessionView {
  return {
    id: CURRENT,
    deviceName: 'iPhone · Safari',
    createdAt: new Date('2026-09-01T10:00:00Z'),
    lastSeenAt: new Date('2026-09-02T10:00:00Z'),
    current: true,
    ...patch,
  }
}

const both: SessionsResponse = {
  sessions: [session({}), session({ id: LAPTOP, deviceName: 'Windows · Chrome', current: false })],
  total: 2,
}

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().id = ACTOR
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/settings/devices')
  const view = mount(DevicesView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

let clock = 0

beforeEach(() => {
  vi.restoreAllMocks()
  sessions.mockReset()
  endSession.mockReset()
  online(true)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

/** «Sign out» on the laptop's row, and the sheet given time to rise — until then it takes no tap. */
async function askToEnd(view: VueWrapper): Promise<void> {
  const button = view.findAll('button').find((found) => found.text() === en.devices.end)
  await button?.trigger('click')
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function confirmButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (button) => button.textContent.trim() === en.devices.end_sheet.confirm,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error('no «Sign out» in the sheet')
  return found
}

describe('«Устройства»', () => {
  it('показывает своё устройство первым, помеченным и без кнопки', async () => {
    sessions.mockResolvedValue(both)
    const view = await render()

    const rows = view.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('iPhone · Safari')
    expect(rows[0]?.text()).toContain(en.devices.this_device)
    expect(rows[0]?.find('button').exists()).toBe(false)
    // У текущей «были» не пишется: это сейчас.
    expect(rows[0]?.text()).not.toContain('last seen')
    expect(rows[1]?.text()).toContain('Windows · Chrome')
    expect(rows[1]?.text()).toContain('last seen')
    expect(rows[1]?.find('button').attributes('aria-label')).toBe('Sign out Windows · Chrome')
  })

  it('безымянное устройство называется «неизвестным», а не пустой строкой', async () => {
    sessions.mockResolvedValue({
      sessions: [session({}), session({ id: LAPTOP, deviceName: null, current: false })],
      total: 2,
    })
    const view = await render()
    expect(view.findAll('li')[1]?.text()).toContain(en.devices.unknown)
  })

  it('говорит, что список обрезан, когда строк больше предела', async () => {
    sessions.mockResolvedValue({ ...both, total: 60 })
    const view = await render()
    expect(view.text()).toContain('Showing the latest 2 of 60')
  })

  it('пустого состояния нет: список из одной своей строки — это список', async () => {
    sessions.mockResolvedValue({ sessions: [session({})], total: 1 })
    const view = await render()
    expect(view.findAll('li')).toHaveLength(1)
    expect(view.find('.state').exists()).toBe(false)
  })

  it('пока грузится — скелетон', async () => {
    sessions.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
  })

  it('сбой при связи — красная ошибка с повтором, и повтор перечитывает', async () => {
    sessions.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL)).mockResolvedValueOnce(both)
    const view = await render()
    expect(view.text()).toContain(en.devices.load_error.title)

    const retry = view.findAll('button').find((button) => button.text() === en.state.retry)
    await retry?.trigger('click')
    await flushPromises()
    expect(view.findAll('li')).toHaveLength(2)
  })

  it('обрыв связи во время запроса — жёлтое «нет связи», а не красная ошибка, и без памяти', async () => {
    sessions.mockImplementation(() => {
      online(false)
      return Promise.reject(new ApiError(ERROR.INTERNAL))
    })
    const view = await render()
    expect(view.text()).toContain(en.devices.offline.title)
    expect(view.text()).not.toContain(en.devices.load_error.title)
    expect(view.findAll('li')).toHaveLength(0)

    // Связь вернулась — экран поднимается сам.
    sessions.mockReset()
    sessions.mockResolvedValue(both)
    online(true)
    window.dispatchEvent(new Event('online'))
    await flushPromises()
    expect(view.findAll('li')).toHaveLength(2)
  })
})

describe('«Завершить»', () => {
  it('сначала спрашивает, называя устройство, и только потом завершает', async () => {
    sessions.mockResolvedValueOnce(both)
    const view = await render()
    await askToEnd(view)

    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      'Sign out Windows · Chrome?',
    )
    expect(endSession).not.toHaveBeenCalled()

    endSession.mockResolvedValue(undefined)
    sessions.mockResolvedValueOnce({ sessions: [session({})], total: 1 })
    confirmButton().click()
    await flushPromises()

    expect(endSession).toHaveBeenCalledWith(LAPTOP)
    expect(view.findAll('li')).toHaveLength(1)
  })

  it('«уже нет» от сервера — тоже успех: строка уходит, ошибки нет', async () => {
    sessions.mockResolvedValueOnce(both)
    const view = await render()
    await askToEnd(view)

    endSession.mockRejectedValue(new ApiError(ERROR.NOT_FOUND))
    sessions.mockResolvedValueOnce({ sessions: [session({})], total: 1 })
    confirmButton().click()
    await flushPromises()

    expect(view.findAll('li')).toHaveLength(1)
    expect(document.body.textContent).not.toContain(en.devices.end_failed)
  })

  it('сбой — слова в шторке, шторка остаётся, строка на месте', async () => {
    sessions.mockResolvedValue(both)
    const view = await render()
    await askToEnd(view)

    endSession.mockRejectedValue(new ApiError(ERROR.INTERNAL))
    confirmButton().click()
    await flushPromises()

    expect(document.querySelector('dialog[open]')?.textContent).toContain(en.devices.end_failed)
    expect(view.findAll('li')).toHaveLength(2)
  })

  it('404 портала, а не сервера, — не «уже нет», а сбой', async () => {
    sessions.mockResolvedValue(both)
    const view = await render()
    await askToEnd(view)

    endSession.mockRejectedValue(new ApiError(ERROR.NOT_FOUND, undefined, false))
    confirmButton().click()
    await flushPromises()

    expect(document.querySelector('dialog[open]')?.textContent).toContain(en.devices.end_failed)
  })
})
