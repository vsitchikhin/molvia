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
  readonly provider?: 'cba' | 'cbr' | 'erapi' | 'nbg' | 'nbs' | null
  readonly stale?: boolean
  /** A trip in Tbilisi: lari against roubles, the National Bank of Georgia's pair (MOL-110). */
  readonly lari?: boolean
  /**
   * A trip in Belgrade (MOL-230): dinars against roubles — the National Bank of Serbia's pair — or,
   * with `dram`, against drams, the National Bank of Georgia's.
   */
  readonly dinar?: 'rouble' | 'dram'
  readonly jump?: {
    previous?: string | null
    choice?: 'jumped' | 'previous' | 'manual' | null
    manual?: string | null
  }
}

const rate = (value: string, source = 'official', quote = 'AMD', base = 'RUB') => ({
  base,
  quote,
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
    currency: over.lari ? 'GEL' : over.dinar ? 'RSD' : 'AMD',
    rate: over.lari
      ? rate('0.0312', source, 'GEL')
      : over.dinar === 'rouble'
        ? rate('1.2257', source, 'RSD')
        : over.dinar === 'dram'
          ? rate('0.2891', source, 'RSD', 'AMD')
          : rate('4.82', source),
    rateProvider: over.provider === undefined ? 'cba' : over.provider,
    rateJump: over.jump
      ? {
          jumped: rate('4.82', source),
          previous: over.jump.previous ? rate(over.jump.previous, source) : null,
          manual: over.jump.manual ? { ...rate(over.jump.manual), source: 'personal' } : null,
          choice: over.jump.choice ?? null,
        }
      : null,
    rateStale: over.stale ?? false,
    place: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'store',
      name: 'Ереван Сити',
    },
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
    // Шторка выбора смонтирована всегда и закрыта — на экране от неё ничего нет.
    const view = await render()
    expect(view.findAll('.note')).toHaveLength(0)
    expect(document.body.querySelector('dialog[open]')).toBeNull()
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

  describe('лари — банк пары НБ Грузии (MOL-110)', () => {
    it('курс НБ Грузии у похода в лари — без слова, как ЦБ РА у драма', async () => {
      const view = await render({ lari: true, provider: 'nbg' })
      expect(view.findAll('.note')).toHaveLength(0)
    })

    it('ЦБ РА у похода в лари — запасной: молчит НБ Грузии, источник — ЦБ РА', async () => {
      const view = await render({ lari: true, source: 'fallback', provider: 'cba' })
      expect(plain(view)).toContain(
        'Курс не от НБ Грузии — он молчит больше недели. Источник: ЦБ РА',
      )
    })

    it('«устарел» у курса НБ Грузии называет НБ Грузии', async () => {
      const view = await render({ lari: true, provider: 'nbg', stale: true })
      expect(view.text()).toContain('с тех пор НБ Грузии ничего не публиковал')
      expect(view.text()).not.toContain('ЦБ РА')
    })
  })

  describe('динар — НБ Сербии или НБ Грузии, по второй валюте пары (MOL-230)', () => {
    it('курс НБ Сербии у похода в динарах с доходом в рублях — без слова', async () => {
      const view = await render({ dinar: 'rouble', provider: 'nbs' })
      expect(view.findAll('.note')).toHaveLength(0)
    })

    it('ЦБ РФ у похода в динарах — запасной: молчит НБ Сербии', async () => {
      const view = await render({ dinar: 'rouble', source: 'fallback', provider: 'cbr' })
      expect(plain(view)).toContain(
        'Курс не от НБ Сербии — он молчит больше недели. Источник: ЦБ РФ',
      )
    })

    it('«устарел» у курса НБ Сербии называет НБ Сербии', async () => {
      const view = await render({ dinar: 'rouble', provider: 'nbs', stale: true })
      expect(view.text()).toContain('с тех пор НБ Сербии ничего не публиковал')
    })

    it('динар к драму — пара НБ Грузии: молчит он, а не НБ Сербии', async () => {
      const view = await render({ dinar: 'dram', source: 'fallback', provider: 'cbr' })
      expect(plain(view)).toContain('Курс не от НБ Грузии — он молчит больше недели')
      expect(view.text()).not.toContain('НБ Сербии')
    })
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

    it('свой курс подставляется как число, а не как своя же печать (В3)', async () => {
      const view = await render({ jump: { previous: null, choice: 'manual', manual: '4312.3' } })
      await button(view, ru.trip.rate.choose).trigger('click')
      await flushPromises()

      const field = document.body.querySelector('dialog[open]')?.querySelector('input')
      // «4 312,3» с неразрывным пробелом сервер не примет, «4312.300000» человек не набирал.
      expect(field?.value).toBe('4312,3')
    })

    // Доход в рублях, траты в долларах: снимок ₽ → $ меньше единицы (MOL-81, адв. А).
    describe('пара меньше единицы', () => {
      const small = (value: string, source = 'official') => ({
        ...rate(value, source),
        quote: 'USD',
      })
      function smallTrip(manual: string | null): TripView {
        return tripViewCodec.parse({
          id: TRIP,
          startedAt: '2026-01-16T08:00:00.000Z',
          finishedAt: null,
          rateProvider: 'cba',
          rateStale: false,
          place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
          expenses: [],
          total: [],
          converted: null,
          currency: 'USD',
          rate: small('0.1114'),
          rateJump: {
            jumped: small('0.1114'),
            previous: small('0.011143'),
            manual: manual ? small(manual, 'personal') : null,
            choice: manual ? 'manual' : null,
          },
        })
      }
      async function openSmall(manual: string | null) {
        setActivePinia(createPinia())
        const router = createRouter({ history: createMemoryHistory(), routes })
        await router.push('/')
        const view = mount(TripRateNotes, {
          props: { trip: smallTrip(manual) },
          global: { plugins: [router, createAppI18n('ru')] },
          attachTo: document.body,
        })
        mounted.push(view)
        await button(view, ru.trip.rate.choose).trigger('click')
        await flushPromises()
        clock += 1000
        const sheet = document.body.querySelector('dialog[open]')
        if (!sheet) throw new Error('шторка не открылась')
        return sheet
      }

      it('поле спрашивает той стороной, какой напечатаны варианты: «1 $ =» под «89,74 ₽/$»', async () => {
        const sheet = await openSmall(null)
        expect(sheet.textContent.replaceAll('\u00a0', ' ')).toContain('89,74 ₽/$')
        inside(sheet, ru.trip.rate.mine).click()
        await flushPromises()
        expect(sheet.querySelector('label')?.textContent).toContain('1 $ =')
      })

      it('введённое уходит с валютой, за единицу которой оно сказано', async () => {
        chooseTripRate.mockResolvedValue(smallTrip('0.011173'))
        const sheet = await openSmall(null)
        inside(sheet, ru.trip.rate.mine).click()
        await flushPromises()
        const field = sheet.querySelector('input')
        if (!field) throw new Error('нет поля')
        field.value = '89,50'
        field.dispatchEvent(new Event('input'))
        await flushPromises()
        inside(sheet, ru.trip.rate.save).click()
        await flushPromises()
        expect(chooseTripRate).toHaveBeenCalledWith(TRIP, {
          choice: 'manual',
          rate: '89.50',
          per: 'USD',
        })
      })

      it('свой курс подставляется той же стороной, двумя знаками — как набирали', async () => {
        const sheet = await openSmall('0.011173')
        // 1 / 0,011173 = 89,501…: «89,5», а не «0,011173» и не «89,501477».
        expect(sheet.querySelector('input')?.value).toBe('89,5')
      })
    })

    // Прыжок — это запятая не там, и он легко перешагивает единицу (ревью Т-9, адв. А′).
    describe('прыжок через единицу', () => {
      interface Jump {
        quote: 'AMD' | 'USD'
        jumped: string
        previous: string
        manual?: string
        choice?: 'jumped' | 'previous' | 'manual'
      }
      const at = (quote: Jump['quote'], value: string, source = 'official') => ({
        ...rate(value, source),
        quote,
      })
      function jumpedTrip(jump: Jump): TripView {
        const current =
          jump.choice === 'manual' && jump.manual
            ? at(jump.quote, jump.manual, 'personal')
            : jump.choice === 'previous'
              ? at(jump.quote, jump.previous)
              : at(jump.quote, jump.jumped)
        return tripViewCodec.parse({
          id: TRIP,
          startedAt: '2026-01-16T08:00:00.000Z',
          finishedAt: null,
          rateProvider: 'cba',
          rateStale: false,
          place: { id: 'aaaaaaaa-0000-4000-8000-000000000001', kind: 'store', name: 'Ереван Сити' },
          expenses: [],
          total: [],
          converted: null,
          currency: jump.quote,
          rate: current,
          rateJump: {
            jumped: at(jump.quote, jump.jumped),
            previous: at(jump.quote, jump.previous),
            manual: jump.manual ? at(jump.quote, jump.manual, 'personal') : null,
            choice: jump.choice ?? null,
          },
        })
      }
      async function open(jump: Jump) {
        setActivePinia(createPinia())
        const router = createRouter({ history: createMemoryHistory(), routes })
        await router.push('/')
        const view = mount(TripRateNotes, {
          props: { trip: jumpedTrip(jump) },
          global: { plugins: [router, createAppI18n('ru')] },
          attachTo: document.body,
        })
        mounted.push(view)
        const note = view.text().replaceAll('\u00a0', ' ')
        await button(view, ru.trip.rate.choose).trigger('click')
        await flushPromises()
        clock += 1000
        const sheet = document.body.querySelector('dialog[open]')
        if (!sheet) throw new Error('шторка не открылась')
        const values = [...sheet.querySelectorAll('.value')].map((node) =>
          node.textContent.replaceAll('\u00a0', ' ').trim(),
        )
        return { sheet, note, values }
      }
      async function type(sheet: Element, typed: string) {
        inside(sheet, ru.trip.rate.mine).click()
        await flushPromises()
        const field = sheet.querySelector('input')
        if (!field) throw new Error('нет поля')
        field.value = typed
        field.dispatchEvent(new Event('input'))
        await flushPromises()
        inside(sheet, ru.trip.rate.save).click()
        await flushPromises()
      }

      it('день прежнего курса — днём Еревана, не моментом его полуночи (адв. Ж″)', async () => {
        const { note } = await open({ quote: 'AMD', jumped: '0.43', previous: '4.30' })
        // asOf фикстуры — 15 января, 12:00 UTC: 15 янв. и в Ереване.
        expect(note).toContain('от 15 янв.')
      })

      it('пара владельца, 4,30 → 0,43: всё «֏/₽», поле «1 ₽ =», «4,30» уходит без валюты', async () => {
        chooseTripRate.mockResolvedValue(
          jumpedTrip({ quote: 'AMD', jumped: '0.43', previous: '4.30' }),
        )
        const { sheet, note, values } = await open({
          quote: 'AMD',
          jumped: '0.43',
          previous: '4.30',
        })
        expect(note).toContain('0,43 ֏/₽ вместо 4,30 ֏/₽')
        expect(values.slice(0, 2)).toEqual(['0,43 ֏/₽', '4,30 ֏/₽'])
        await type(sheet, '4,30')
        expect(sheet.querySelector('label')?.textContent).toContain('1 ₽ =')
        expect(chooseTripRate).toHaveBeenCalledWith(TRIP, { choice: 'manual', rate: '4.30' })
      })

      it('₽ → $, 0,011143 → 1,114: всё «₽/$», поле «1 $ =», число уходит с валютой', async () => {
        chooseTripRate.mockResolvedValue(
          jumpedTrip({ quote: 'USD', jumped: '1.114', previous: '0.011143' }),
        )
        const { sheet, values } = await open({
          quote: 'USD',
          jumped: '1.114',
          previous: '0.011143',
        })
        expect(values.slice(0, 2)).toEqual(['0,897666 ₽/$', '89,74 ₽/$'])
        await type(sheet, '89,50')
        expect(sheet.querySelector('label')?.textContent).toContain('1 $ =')
        expect(chooseTripRate).toHaveBeenCalledWith(TRIP, {
          choice: 'manual',
          rate: '89.50',
          per: 'USD',
        })
      })

      it('свой курс, выбранный раньше, при «По новому» стоит в поле стороной шторки', async () => {
        const { sheet } = await open({
          quote: 'USD',
          jumped: '1.114',
          previous: '0.011143',
          manual: '0.01117',
          choice: 'jumped',
        })
        inside(sheet, ru.trip.rate.mine).click()
        await flushPromises()
        expect(sheet.querySelector('label')?.textContent).toContain('1 $ =')
        expect(sheet.querySelector('input')?.value).toBe('89,53')
      })
    })

    it('must not fire: у пары владельца поле «1 ₽ =» и число уходит без валюты', async () => {
      chooseTripRate.mockResolvedValue(
        trip({ jump: { previous: null, choice: 'manual', manual: '4.81' } }),
      )
      const view = await render({ jump: { previous: null } })
      await button(view, ru.trip.rate.choose).trigger('click')
      await flushPromises()
      clock += 1000
      const sheet = document.body.querySelector('dialog[open]')
      inside(sheet, ru.trip.rate.mine).click()
      await flushPromises()
      expect(sheet?.querySelector('label')?.textContent).toContain('1 ₽ =')
      const field = sheet?.querySelector('input')
      if (!field) throw new Error('нет поля')
      field.value = '4,81'
      field.dispatchEvent(new Event('input'))
      await flushPromises()
      inside(sheet, ru.trip.rate.save).click()
      await flushPromises()
      expect(chooseTripRate).toHaveBeenCalledWith(TRIP, { choice: 'manual', rate: '4.81' })
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
