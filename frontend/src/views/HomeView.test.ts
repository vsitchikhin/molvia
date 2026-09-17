import { mount } from '@vue/test-utils'
import type { HealthResponse } from '@molvia/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import HomeView from '@/views/HomeView.vue'

const health = vi.fn<() => Promise<HealthResponse>>()
vi.mock('@/api', () => ({ api: { health: () => health() } }))

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

/**
 * Built through the app's own factory, not a handwritten `createI18n`.
 *
 * A test that configures i18n by hand drifts from production silently: without `pluralRules`
 * a Russian counter answers «2 позиций» here and «2 позиции» in the app, and without
 * `fallbackLocale` a missing key prints its own name instead of the English text. Either way
 * the test confirms behaviour nobody ships.
 */
function render(locale: 'ru' | 'en' = 'en') {
  return mount(HomeView, { global: { plugins: [createAppI18n(locale)] } })
}

describe('HomeView', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    health.mockReset()
  })

  it('shows the offline state without calling the API at all', async () => {
    online(false)
    const view = render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.advice.offline.title)
    })
    expect(health).not.toHaveBeenCalled()
  })

  it('reports a failure instead of an empty screen, and offers a retry', async () => {
    online(true)
    health.mockRejectedValue(new Error('boom'))
    const view = render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.advice.error.title)
    })
    expect(view.find('button').text()).toBe(en.state.retry)
  })

  it('recovers when the retry succeeds', async () => {
    online(true)
    health
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ status: 'ok', version: '1.2.3', database: 'up' })
    const view = render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.advice.error.title)
    })

    await view.find('button').trigger('click')
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
    const view = render('ru')

    await vi.waitFor(() => {
      expect(view.text()).toContain('1.2.3')
    })
    expect(view.text()).toContain(ru.advice.title)
    expect(view.text()).toContain(ru.advice.empty.body)
    expect(view.find('button').text()).toBe(ru.advice.empty.action)
  })
})
