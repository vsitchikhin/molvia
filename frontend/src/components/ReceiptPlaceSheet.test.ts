import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ReceiptPlaceSheet from '@/components/ReceiptPlaceSheet.vue'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'

vi.mock('@/api', () => ({
  api: { recentPlaces: () => Promise.resolve([]) },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const PLACE = 'aaaaaaaa-0000-4000-8000-000000000009'
/** 22:30 on the 3rd by the phone, in UTC — 02:30 on the 4th in Yerevan, where the till printed. */
const NOW = new Date('2026-10-03T22:30:00Z')
const ACTION = 'Записать 13 покупок'

const mounted: VueWrapper[] = []

async function render(day: string) {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  useActorStore().state = 'ready'
  // The sheet lays an entry in the history: it needs the router, as on a screen.
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/purchases')
  const view = mount(ReceiptPlaceSheet, {
    props: {
      open: true,
      current: { id: PLACE, name: 'Ереван Сити', city: 'Гюмри' },
      read: true,
      day,
      action: ACTION,
    },
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  const button = [...document.body.querySelectorAll('dialog[open] button')].find((node) =>
    node.textContent.includes(ACTION),
  ) as HTMLButtonElement | undefined
  return { view, button }
}

describe('ReceiptPlaceSheet (MOL-127): the day of the purchases', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
    vi.useRealTimers()
  })

  it('the day printed after Yerevan’s midnight passes on a phone west of it (adversarial В1)', async () => {
    const { view, button } = await render('2026-10-04')
    expect(button?.disabled).toBe(false)
    expect(view.html()).not.toContain(ru.spending.sheet.bad_day)
  })

  it('a day the server would not take is still refused: misread far ahead, or before 2000 (review 18, 33)', async () => {
    for (const day of ['2026-10-06', '2099-10-01', '2000-01-01']) {
      const { view, button } = await render(day)
      expect(button?.disabled, day).toBe(true)
      expect(view.html(), day).toContain(ru.spending.sheet.bad_day)
      for (const one of mounted.splice(0)) one.unmount()
    }
  })

  it('the phone’s today passes', async () => {
    const { button } = await render('2026-10-03')
    expect(button?.disabled).toBe(false)
  })
})
