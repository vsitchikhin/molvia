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

const recentPlaces = vi.fn(() => Promise.resolve([] as { id: string; name: string }[]))
vi.mock('@/api', () => ({
  api: { recentPlaces: () => recentPlaces() },
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
      country: 'AM',
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

describe('ReceiptPlaceSheet (MOL-109, adversarial А2): a receipt of another country than the settings', () => {
  /** A person whose settings moved to Tbilisi, with an Armenian receipt taken before. */
  async function away(current: { name: string; city: string } | null) {
    localStorage.setItem('molvia.actor', ME)
    localStorage.setItem(
      `molvia.settings.${ME}`,
      JSON.stringify({
        country: 'GE',
        city: 'Тбилиси',
        spendCurrency: 'AMD',
        incomeCurrency: 'RUB',
      }),
    )
    recentPlaces.mockResolvedValue([{ id: PLACE, name: 'Carrefour' }])
    const pinia = createPinia()
    setActivePinia(pinia)
    useActorStore().state = 'ready'
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/purchases')
    const view = mount(ReceiptPlaceSheet, {
      props: {
        open: true,
        country: 'AM',
        current,
        read: current !== null,
        day: '2026-09-26',
        action: ACTION,
      },
      global: { plugins: [router, pinia, createAppI18n('ru')] },
      attachTo: document.body,
    })
    mounted.push(view)
    await flushPromises()
    return view
  }

  afterEach(() => {
    for (const view of mounted.splice(0)) view.unmount()
    localStorage.clear()
  })

  const select = () => document.body.querySelector('dialog[open] select')

  async function record(view: Awaited<ReturnType<typeof away>>, name: string) {
    await view.get('input:not([type="date"])').setValue(name)
    await flushPromises()
    const button = [...document.body.querySelectorAll('dialog[open] button')].find((node) =>
      node.textContent.includes(ACTION),
    ) as HTMLButtonElement
    // the sheet takes no press until it has risen (BottomSheet): its clock moves on
    vi.spyOn(performance, 'now').mockReturnValue(60_000)
    button.click()
    await flushPromises()
    return (view.emitted('chosen') as [[{ name: string; city: string }, string]] | undefined)?.[0]
  }

  it('offers the receipt country’s cities, not the settings’ Tbilisi, and its new shop is there', async () => {
    const view = await away(null)
    expect([...(select()?.options ?? [])].map((option) => option.value)).toEqual([
      'Гюмри',
      'Ереван',
    ])
    const [place] = (await record(view, 'Ереван Сити')) ?? []
    expect(place).toEqual({ name: 'Ереван Сити', city: 'Гюмри' })
  })

  it('takes the city read off the receipt first', async () => {
    await away({ name: 'SAS', city: 'Ереван' })
    expect(select()?.value).toBe('Ереван')
  })

  it('does not offer the shops of Tbilisi: the server would refuse them', async () => {
    await away(null)
    expect(document.body.querySelector('dialog[open]')?.textContent).not.toContain('Carrefour')
  })

  it('must not fire: a receipt of the person’s own country has no city field', async () => {
    await render('2026-09-26')
    expect(select()).toBeNull()
  })
})
