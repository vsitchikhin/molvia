import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR, tripViewCodec } from '@molvia/model'
import type { RateChoiceBody, TripView } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import { routes } from '@/router'
import TripRateNotes from '@/components/TripRateNotes.vue'
import { useTripStore } from '@/stores/trip'

const chooseTripRate = vi.fn<(tripId: string, body: RateChoiceBody) => Promise<TripView>>()
vi.mock('@/api', () => ({
  api: {
    chooseTripRate: (tripId: string, body: RateChoiceBody) => chooseTripRate(tripId, body),
    currentTrip: () => Promise.resolve(null),
  },
}))

const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

interface Over {
  readonly source?: 'official' | 'fallback' | 'personal'
  readonly provider?: 'cba' | 'cbr' | 'erapi' | null
  readonly stale?: boolean
  readonly jump?: { previous?: string | null; choice?: 'jumped' | 'previous' | 'manual' | null }
}

const rate = (value: string, source = 'official') => ({
  base: 'RUB',
  quote: 'AMD',
  rate: value,
  source,
  asOf: '2026-01-15T12:00:00.000Z',
})

function trip(over: Over = {}): TripView {
  const source = over.source ?? 'official'
  return tripViewCodec.parse({
    id: TRIP,
    startedAt: '2026-01-16T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate: rate('4.82', source),
    rateProvider: over.provider === undefined ? 'cba' : over.provider,
    rateJump: over.jump
      ? {
          jumped: rate('4.82', source),
          previous: over.jump.previous ? rate(over.jump.previous, source) : null,
          manual: null,
          choice: over.jump.choice ?? null,
        }
      : null,
    rateStale: over.stale ?? false,
    place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
    expenses: [],
    total: [],
    converted: null,
  })
}

const plain = (found: { text: () => string }): string => found.text().replaceAll(' ', ' ')

/** Пока шторка не поднялась, она не берёт нажатий (MOL-18). */
let clock = 0

const mounted: VueWrapper[] = []

async function render(over: Over = {}) {
  setActivePinia(createPinia())
  // Шторка кладёт запись в историю роутера — без него она не поднимется (MOL-18).
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  const view = mount(TripRateNotes, {
    props: { trip: trip(over) },
    global: { plugins: [router, createAppI18n('ru')] },
    attachTo: document.body,
  })
  mounted.push(view)
  return view
}

/** Кнопка в поднятой шторке: закрытые `<dialog>` висят в дереве и не в счёт. */
function inside(sheet: Element | null, text: string): HTMLButtonElement {
  const found = [...(sheet?.querySelectorAll('button') ?? [])].find((node) =>
    node.textContent.includes(text),
  )
  if (!found) throw new Error(`нет кнопки «${text}» в шторке`)
  return found
}

function button(view: VueWrapper, text: string) {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`нет кнопки «${text}»`)
  return found
}

describe('TripRateNotes', () => {
  beforeEach(() => {
    localStorage.clear()
    chooseTripRate.mockReset()
    clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
  })

  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('обычный курс ЦБ РА не требует ни слова', async () => {
    expect((await render()).text()).toBe('')
  })

  it('запасной источник назван по имени, а не «какой-то другой»', async () => {
    const view = await render({ source: 'fallback', provider: 'cbr' })
    expect(view.text()).toContain(ru.trip.rate.source_cbr)
    expect(view.find('a').exists()).toBe(false)
  })

  it('у агрегатора рядом ссылка — этого требуют его условия', async () => {
    const view = await render({ source: 'fallback', provider: 'erapi' })
    expect(view.get('a').attributes('href')).toBe('https://www.exchangerate-api.com')
    expect(view.get('a').attributes('rel')).toContain('noopener')
  })

  it('«устарел» у ЦБ РА и у запасного — разные тексты: про ЦБ РА второй был бы ложью', async () => {
    expect((await render({ stale: true })).text()).toContain('ЦБ РА ничего не публиковал')
    const fallback = await render({ stale: true, source: 'fallback', provider: 'cbr' })
    expect(fallback.text()).not.toContain('ЦБ РА ничего не публиковал')
    expect(fallback.text()).toContain('свежее никто ничего не опубликовал')
  })

  describe('скачок', () => {
    it('показывает прежний курс с датой и зовёт выбрать', async () => {
      const view = await render({ jump: { previous: '3.79' } })
      expect(view.text()).toContain(ru.trip.rate.jump_title)
      expect(plain(view)).toContain('4,82 ֏/₽ вместо 3,79 ֏/₽ от 15 янв.')
      expect(button(view, ru.trip.rate.choose).exists()).toBe(true)
    })

    it('прежнего курса нет — так и сказано, и в выборе его нет', async () => {
      const view = await render({ jump: { previous: null } })
      expect(view.text()).toContain('прежнего курса рядом нет')

      await button(view, ru.trip.rate.choose).trigger('click')
      const sheet = document.body.querySelector('dialog[open]')
      expect(sheet?.textContent).toContain(ru.trip.rate.new)
      expect(sheet?.textContent).not.toContain(ru.trip.rate.old)
      expect(sheet?.textContent).toContain(ru.trip.rate.mine)
    })

    it('выбор «по прежнему» уходит на сервер и меняет поход', async () => {
      chooseTripRate.mockResolvedValue(trip({ jump: { previous: '3.79', choice: 'previous' } }))
      const view = await render({ jump: { previous: '3.79' } })
      await button(view, ru.trip.rate.choose).trigger('click')
      await flushPromises()
      clock += 1000

      const sheet = () => document.body.querySelector('dialog[open]')
      inside(sheet(), ru.trip.rate.old).click()
      await flushPromises()
      inside(sheet(), ru.trip.rate.save).click()
      await flushPromises()

      expect(chooseTripRate).toHaveBeenCalledWith(TRIP, { choice: 'previous' })
      expect(useTripStore().current?.rateJump?.choice).toBe('previous')
    })

    it('свой курс, который не курс, остаётся в поле, и шторка не закрывается', async () => {
      chooseTripRate.mockRejectedValue(new ApiError(ERROR.INVALID_RATE, undefined, true))
      const view = await render({ jump: { previous: null } })
      await button(view, ru.trip.rate.choose).trigger('click')
      await flushPromises()
      clock += 1000

      inside(document.body.querySelector('dialog[open]'), ru.trip.rate.mine).click()
      await flushPromises()

      const field = document.body.querySelector('dialog[open]')?.querySelector('input')
      if (!field) throw new Error('нет поля своего курса')
      field.value = 'абв'
      field.dispatchEvent(new Event('input'))
      await flushPromises()

      inside(document.body.querySelector('dialog[open]'), ru.trip.rate.save).click()
      await flushPromises()

      expect(document.body.querySelector('dialog[open]')).not.toBeNull()
      expect(document.body.textContent).toContain(ru.error.invalid_rate)
    })
  })
})
