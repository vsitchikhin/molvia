import { mount } from '@vue/test-utils'
import type { HealthResponse } from '@molvia/model'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from '@/i18n/en.json'
import HomeView from '@/views/HomeView.vue'

const health = vi.fn<() => Promise<HealthResponse>>()
vi.mock('@/api', () => ({ api: { health: () => health() } }))

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

function render() {
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  return mount(HomeView, { global: { plugins: [i18n] } })
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
      expect(view.text()).toContain(en.state.offline)
    })
    expect(health).not.toHaveBeenCalled()
  })

  it('reports a failure instead of an empty screen, and offers a retry', async () => {
    online(true)
    health.mockRejectedValue(new Error('boom'))
    const view = render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.state.error)
    })
    expect(view.find('button').text()).toBe(en.state.retry)
  })

  it('recovers when the retry succeeds', async () => {
    online(true)
    health
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ status: 'ok', version: '1.2.3' })
    const view = render()
    await vi.waitFor(() => {
      expect(view.text()).toContain(en.state.error)
    })

    await view.find('button').trigger('click')
    await vi.waitFor(() => {
      expect(view.text()).toContain('1.2.3')
    })
    expect(view.text()).toContain(en.home.empty)
  })
})
