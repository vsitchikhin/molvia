import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { TripPlace } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import StartTripSheet from '@/components/StartTripSheet.vue'
import { useTripQueueStore } from '@/stores/tripQueue'

const recentPlaces = vi.fn<() => Promise<TripPlace[]>>()
vi.mock('@/api', () => ({
  api: {
    recentPlaces: () => recentPlaces(),
    startTrip: () => new Promise(() => undefined),
    addExpense: () => new Promise(() => undefined),
    currentTrip: () => Promise.resolve(null),
  },
}))

const ME = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

const city: TripPlace = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  kind: 'store',
  name: 'Ереван Сити',
  country: 'AM',
  city: 'Гюмри',
}

let clock = 0
const mounted: VueWrapper[] = []

async function render() {
  localStorage.setItem('molvia.actor', ME)
  localStorage.setItem(
    `molvia.settings.${ME}`,
    JSON.stringify({ country: 'AM', city: 'Гюмри', spendCurrency: 'AMD', incomeCurrency: 'RUB' }),
  )
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const view = mount(StartTripSheet, {
    props: { open: true },
    global: { plugins: [router, pinia, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  await flushPromises()
  clock += 1000
  return { view, queue: useTripQueueStore() }
}

function button(view: VueWrapper, text: string) {
  const found = view.findAll('button').find((node) => node.text() === text)
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

describe('StartTripSheet', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    recentPlaces.mockReset()
    recentPlaces.mockResolvedValue([])
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('поход уходит в очередь, а не в сеть: у двери магазина ответа не ждут', async () => {
    const { view, queue } = await render()
    await view.get('input').setValue('Рынок')
    await button(view, ru.trip.none.action).trigger('click')
    await flushPromises()

    const start = queue.pending.find((write) => write.kind === 'start')
    expect(start?.place).toEqual({ kind: 'store', name: 'Рынок' })
    // Телефон называет поход сам, в нижнем регистре — иначе сервер не примет (MOL-21).
    expect(start?.tripId).toMatch(/^[0-9a-f-]{36}$/)
    expect(view.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('недавнее место начинает поход одним тапом', async () => {
    recentPlaces.mockResolvedValue([city])
    const { view, queue } = await render()

    await button(view, city.name).trigger('click')
    expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe(city.name)
  })

  it('без сети список берётся с телефона, и поход всё равно начинается', async () => {
    localStorage.setItem(
      `molvia.places.${ME}.${JSON.stringify(['AM', 'Гюмри'])}`,
      JSON.stringify({ places: [city] }),
    )
    recentPlaces.mockRejectedValue(new Error('Failed to fetch'))
    const { view, queue } = await render()

    await button(view, city.name).trigger('click')
    expect(queue.pending.find((write) => write.kind === 'start')).toBeDefined()
  })

  it('пустое имя похода не начинает', async () => {
    const { view, queue } = await render()
    await view.get('input').setValue('   ')
    expect(button(view, ru.trip.none.action).attributes('disabled')).toBeDefined()
    expect(queue.pending).toEqual([])
  })

  it('невидимые знаки из буфера не делают второго магазина', async () => {
    // Перенос строки однострочное поле снимает само; направляющие знаки, которыми чат
    // оборачивает скопированное, — нет, и «\u202aЕреван Сити» стало бы вторым местом.
    const { view, queue } = await render()
    await view.get('input').setValue('\u202aЕреван Сити\u202c')
    await flushPromises()
    await button(view, ru.trip.none.action).trigger('click')

    expect(queue.pending.find((write) => write.kind === 'start')?.place.name).toBe('Ереван Сити')
  })
})
