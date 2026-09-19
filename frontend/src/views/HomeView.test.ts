import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import type { HealthResponse } from '@molvia/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import HomeView from '@/views/HomeView.vue'

const health = vi.fn<() => Promise<HealthResponse>>()
vi.mock('@/api', () => ({ api: { health: () => health() } }))

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

// By its words, not by position: the identity notice above the screen has buttons too.
function button(view: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

/**
 * Built through the app's own factory, not a handwritten `createI18n`.
 *
 * A test that configures i18n by hand drifts from production silently: without `pluralRules`
 * a Russian counter answers «2 позиций» here and «2 позиции» in the app, and without
 * `fallbackLocale` a missing key prints its own name instead of the English text. Either way
 * the test confirms behaviour nobody ships.
 */
async function render(locale: 'ru' | 'en' = 'en') {
  // The screen sits in AppScreen, which reads its route and the identity notice's store.
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/advice')
  return mount(HomeView, { global: { plugins: [router, createPinia(), createAppI18n(locale)] } })
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    health.mockReset()
  })

  it('shows the offline state without calling the API at all', async () => {
    online(false)
    const view = await render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.item.offline.title)
    })
    expect(health).not.toHaveBeenCalled()
    // «Showing yesterday's data» would promise what the scaffold does not have (MOL-19, Р-2).
    expect(view.text()).not.toContain(en.advice.offline.title)
  })

  // The commonest break at a shelf: the answer was on its way when the connection went. On
  // master and in the first cut of MOL-19 this was drawn as a red error (A1).
  it('calls a request lost with the connection offline, not an error', async () => {
    online(true)
    health.mockImplementation(() => {
      online(false)
      return Promise.reject(new TypeError('Failed to fetch'))
    })
    const view = await render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.item.offline.title)
    })
    expect(view.text()).not.toContain(en.advice.error.title)
    expect(view.find('.bad').exists()).toBe(false)
  })

  it('tries again by itself when the connection comes back', async () => {
    online(false)
    health.mockResolvedValue({ status: 'ok', version: '1.2.3', database: 'up' })
    const view = await render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.item.offline.title)
    })

    online(true)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => {
      expect(view.text()).toContain('1.2.3')
    })
  })

  it('stops listening once it is gone', async () => {
    online(false)
    const view = await render()
    view.unmount()
    online(true)
    window.dispatchEvent(new Event('online'))
    await Promise.resolve()
    expect(health).not.toHaveBeenCalled()
  })

  it('reports a failure instead of an empty screen, and offers a retry', async () => {
    online(true)
    health.mockRejectedValue(new Error('boom'))
    const view = await render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.advice.error.title)
    })
    expect(() => button(view, en.state.retry)).not.toThrow()
  })

  it('recovers when the retry succeeds', async () => {
    online(true)
    health
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ status: 'ok', version: '1.2.3', database: 'up' })
    const view = await render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.advice.error.title)
    })

    await button(view, en.state.retry).trigger('click')
    await vi.waitFor(() => {
      expect(view.text()).toContain('1.2.3')
    })
    expect(view.text()).toContain(en.advice.empty.body)
  })

  it('рисует по-русски — на языке, который получат все шесть пользователей 0.1', async () => {
    // Русский стал языком по умолчанию, но проверялся только английский: компонентные тесты
    // монтировались с `en`, e2e прибивает браузеру `en-US`. Язык, на котором написан продукт,
    // не видел ни один рендер-тест во всём репозитории — а сверка английского с английским
    // же словарём не показывает ничего.
    online(true)
    health.mockResolvedValue({ status: 'ok', version: '1.2.3', database: 'up' })
    const view = await render('ru')

    await vi.waitFor(() => {
      expect(view.text()).toContain('1.2.3')
    })
    expect(view.text()).toContain(ru.advice.title)
    expect(view.text()).toContain(ru.advice.empty.body)
    expect(() => button(view, ru.advice.empty.action)).not.toThrow()
  })
})
