import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseRate, yerevanMidnight } from '@molvia/model'
import type {
  ExchangeRate,
  ExchangeRateChartView,
  ExchangeRatePeriodView,
  RateChartMonths,
} from '@molvia/model'
import ExchangeRateChart from './ExchangeRateChart.vue'
import { calendarDay } from '@/days'
import { createAppI18n } from '@/i18n'

type Pair = ExchangeRateChartView['pairs'][number]
type Period = ExchangeRatePeriodView
type Point = Period['exchanges'][number]

function rate(value: string, day: string, base: Pair['currency'] = 'RUB'): ExchangeRate {
  return {
    base,
    quote: 'AMD',
    scaled: parseRate(value),
    source: 'official',
    asOf: yerevanMidnight(day),
  }
}

function point(id: string, day: string, step: number, x: number, of: Partial<Point> = {}): Point {
  return {
    id,
    day,
    step,
    x,
    rate: rate('4.58', day),
    level: 400,
    place: 'Ардшинбанк',
    percent: -40,
    market: { rate: rate('4.598', day), level: 430, basis: 'bankCash' },
    ...of,
  }
}

/**
 * The year of the rouble: four weeks from 8 February to 8 March, a day 1000 / 28 of the card — every
 * x by its day, as the server lays it — the third week with no figure, two exchanges in the second.
 * The month and half a year are the test's to give; none — no market in them.
 */
function rouble(of: Partial<Period> = {}, periods: Partial<Pair['periods']> = {}): Pair {
  return {
    currency: 'RUB',
    side: 'bankBuys',
    periods: { 1: null, 6: null, 12: year(of), ...periods },
  }
}

function year(of: Partial<Period> = {}): Period {
  return {
    step: 'week',
    steps: [
      { day: '2026-02-08', rate: rate('4.90', '2026-02-06'), x: 0, level: 1000 },
      { day: '2026-02-15', rate: rate('4.80', '2026-02-13'), x: 250, level: 800 },
      { day: '2026-02-22', rate: null, x: 500, level: null },
      { day: '2026-03-01', rate: rate('4.60', '2026-02-27'), x: 750, level: 450 },
      { day: '2026-03-08', rate: rate('4.30', '2026-03-06'), x: 1000, level: 0 },
    ],
    exchanges: [
      point('a0000000-0000-4000-8000-000000000001', '2026-02-10', 1, 71, { place: null }),
      point('a0000000-0000-4000-8000-000000000002', '2026-02-14', 1, 214, {
        percent: null,
        market: null,
      }),
      point('a0000000-0000-4000-8000-000000000003', '2026-02-28', 3, 714),
    ],
    levels: [
      { rate: rate('4.30', '2026-03-04'), level: 0 },
      { rate: rate('4.60', '2026-03-04'), level: 500 },
      { rate: rate('4.90', '2026-03-04'), level: 1000 },
    ],
    ...of,
  }
}

const dollar: Pair = {
  currency: 'USD',
  side: 'bankBuys',
  periods: {
    1: null,
    6: null,
    12: {
      step: 'week',
      steps: [
        { day: '2026-02-08', rate: rate('386', '2026-02-06', 'USD'), x: 0, level: 0 },
        { day: '2026-03-04', rate: rate('392', '2026-03-04', 'USD'), x: 1000, level: 1000 },
      ],
      exchanges: [],
      levels: [{ rate: rate('389', '2026-03-04', 'USD'), level: 500 }],
    },
  },
}

function chart(pairs: Pair[] = [rouble()], months: RateChartMonths = 12) {
  const view = mount(ExchangeRateChart, {
    props: { chart: { pairs }, months },
    global: { plugins: [createAppI18n('ru')] },
  })
  const area = view.find('.area').element
  area.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect
  return { view, area }
}

const touch = (type: string, x: number, y = 50) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'touch', bubbles: true })

async function tap(view: ReturnType<typeof chart>['view'], area: Element, x: number) {
  area.dispatchEvent(touch('pointerdown', x))
  area.dispatchEvent(touch('pointerup', x))
  await view.vm.$nextTick()
}

/** A touch lifted where it landed, at a height. */
async function at(view: ReturnType<typeof chart>['view'], area: Element, x: number, y: number) {
  const event = (type: string) =>
    new PointerEvent(type, { clientX: x, clientY: y, pointerType: 'touch', bubbles: true })
  area.dispatchEvent(event('pointerdown'))
  area.dispatchEvent(event('pointerup'))
  await view.vm.$nextTick()
}

/** «22 мар.» — a week's day as the reading prints it. */
const calendarDayOf = (day: string) => calendarDay(day, 'ru', { day: 'numeric', month: 'short' })

/** `Intl` puts a no-break space before «%»: read as the eye reads it. */
const plain = (text: string | undefined) => text?.replaceAll('\u00a0', ' ')

const reading = (view: ReturnType<typeof chart>['view']) =>
  view.find('.reading').text().replace(/\s+/g, ' ')

describe('ExchangeRateChart (MOL-161)', () => {
  it('opens on the latest exchange: its week, the market of the week, the place and the percent', () => {
    const { view } = chart()
    expect(view.find('h2').text()).toBe('Курс рубля за 12 месяцев')
    expect(view.find('.legend').text()).toContain('Рынок · все клиенты банков')
    expect(reading(view)).toContain('Неделя по 1 мар. · рынок')
    expect(view.find('.figure').text()).toBe('4,60 ֏/₽')
    expect(view.find('.mine-rate').text()).toBe('Мой обмен 28 февр. · 4,58 ֏/₽')
    expect(plain(view.find('.mine-place').text())).toBe('Ардшинбанк · −0,40 % к рынку')
    expect(view.findAll('.point.chosen')).toHaveLength(1)
  })

  it('a finger lifted on a week with no exchange chooses the week', async () => {
    const { view, area } = chart()
    await tap(view, area, 3)
    expect(reading(view)).toContain('Неделя по 8 февр. · рынок')
    expect(view.find('.none').text()).toBe('Обменов на этой неделе не было')
    expect(view.find('.mine').exists()).toBe(false)
  })

  it('the exchange nearest the finger, each by its own day (handoff 05)', async () => {
    const { view, area } = chart()
    // 64 px of 300 is x 213: the exchange of 14 February, the second of its week.
    await tap(view, area, 64)
    expect(view.find('.mine-rate').text()).toContain('14 февр.')
    expect(plain(view.find('.mine-place').text())).toBe('Ардшинбанк · рынка того дня нет')
    await tap(view, area, 21)
    expect(view.find('.mine-rate').text()).toContain('10 февр.')
    expect(plain(view.find('.mine-place').text())).toBe('Без места · −0,40 % к рынку')
  })

  it('a tap right on an exchange of a Monday chooses it, not the week ending the day before', async () => {
    // 23 February is a Monday of the week to 1 March, a day past the end of the week to the 22nd.
    const monday = point('a0000000-0000-4000-8000-000000000004', '2026-02-23', 3, 536)
    const { view, area } = chart([rouble({ exchanges: [monday] })])
    await tap(view, area, 161)
    expect(view.find('.mine-rate').text()).toContain('23 февр.')
  })

  it('of two exchanges of one day, the one the finger is on — by its height (adversarial Б)', async () => {
    const morning = point('a0000000-0000-4000-8000-000000000005', '2026-02-24', 3, 571, {
      place: 'Утро',
      level: 200,
    })
    const evening = point('a0000000-0000-4000-8000-000000000006', '2026-02-24', 3, 571, {
      place: 'Вечер',
      level: 800,
    })
    const { view, area } = chart([rouble({ exchanges: [morning, evening] })])
    // 300 × 180 px: a level is drawn at 1000 − 50 − level × 0.9 thousandths of the height.
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const at = async (x: number, y: number) => {
      area.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: x,
          clientY: y,
          pointerType: 'touch',
          bubbles: true,
        }),
      )
      area.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: x,
          clientY: y,
          pointerType: 'touch',
          bubbles: true,
        }),
      )
      await view.vm.$nextTick()
    }
    // «Утро» at level 200: y = (1000 − 50 − 180) × 0.18 = 138.6 px; «Вечер» at 800: 30.6 px.
    await at(171, 139)
    expect(view.find('.mine-place').text()).toContain('Утро')
    await at(171, 31)
    expect(view.find('.mine-place').text()).toContain('Вечер')
    await at(171, 139)
    expect(view.find('.mine-place').text()).toContain('Утро')
  })

  it('with a finger far across, the height does not take a mark from another week', async () => {
    const { view, area } = chart()
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    // Right at the first week's end, at the height of the exchange of 28 February far away.
    area.dispatchEvent(
      new PointerEvent('pointerdown', {
        clientX: 1,
        clientY: 102,
        pointerType: 'touch',
        bubbles: true,
      }),
    )
    area.dispatchEvent(
      new PointerEvent('pointerup', {
        clientX: 1,
        clientY: 102,
        pointerType: 'touch',
        bubbles: true,
      }),
    )
    await view.vm.$nextTick()
    expect(view.find('.none').text()).toBe('Обменов на этой неделе не было')
  })

  it('over a week of a phone-sized line the height chooses no other week (review 4, adversarial Ж)', async () => {
    // Fifty weeks 20 thousandths apart — some 6 px on 300 — the line rising, one gap, no exchange.
    const weeks = Array.from({ length: 51 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 9, 12) + index * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10)
      return index === 30
        ? { day, rate: null, x: index * 20, level: null }
        : { day, rate: rate('4.50', day), x: index * 20, level: index * 20 }
    })
    const { view, area } = chart([rouble({ steps: weeks, exchanges: [] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const weekAt = async (index: number, y: number) => {
      await at(view, area, index * 6, y)
      return view.find('.reading .week').text()
    }
    const name = (index: number) => `Неделя по ${calendarDayOf(weeks[index]?.day ?? '')} · рынок`
    for (const y of [2, 90, 178]) expect(await weekAt(25, y)).toBe(name(25))
    // The gap is chosen by its x at any height, and says it has no market.
    for (const y of [2, 90, 178]) {
      expect(await weekAt(30, y)).toBe(name(30))
      expect(view.find('.figure').text()).toBe('Рынка за эту неделю нет')
    }
  })

  it('a second tap on two exchanges of one day at one rate chooses the other (adversarial И)', async () => {
    const one = point('a0000000-0000-4000-8000-000000000007', '2026-02-24', 3, 571, {
      place: 'Касса 1',
    })
    const two = point('a0000000-0000-4000-8000-000000000008', '2026-02-24', 3, 571, {
      place: 'Касса 2',
    })
    const { view, area } = chart([rouble({ exchanges: [one, two] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    // Opened on the latest, «Касса 2»; a tap on the dot turns to «Касса 1», another back.
    expect(view.find('.mine-place').text()).toContain('Касса 2')
    await at(view, area, 171, 100)
    expect(view.find('.mine-place').text()).toContain('Касса 1')
    await at(view, area, 171, 100)
    expect(view.find('.mine-place').text()).toContain('Касса 2')
  })

  it('must not fire: a finger sliding over such marks does not turn them over', async () => {
    const one = point('a0000000-0000-4000-8000-000000000007', '2026-02-24', 3, 571, {
      place: 'Касса 1',
    })
    const two = point('a0000000-0000-4000-8000-000000000008', '2026-02-24', 3, 571, {
      place: 'Касса 2',
    })
    const { view, area } = chart([rouble({ exchanges: [one, two] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const event = (type: string, x: number) =>
      new PointerEvent(type, { clientX: x, clientY: 100, pointerType: 'touch', bubbles: true })
    // Down on the dot, sideways past the slop, back over it, lifted on it.
    area.dispatchEvent(event('pointerdown', 171))
    for (const x of [180, 176, 172]) area.dispatchEvent(event('pointermove', x))
    area.dispatchEvent(event('pointerup', 172))
    await view.vm.$nextTick()
    expect(view.find('.mine-place').text()).toContain('Касса 2')
  })

  it('with a market and no central bank rate to measure by, says that, not «no market» (К)', () => {
    const { view } = chart([
      rouble({
        exchanges: [
          point('a0000000-0000-4000-8000-000000000009', '2026-02-28', 3, 714, { percent: null }),
        ],
      }),
    ])
    expect(view.findAll('.mark')).toHaveLength(2)
    expect(view.find('.mine-place').text()).toBe(
      'Ардшинбанк · без сравнения: курса ЦБ РА того дня нет',
    )
  })

  it('a tap anywhere on a dot chooses it, not the week whose end lies nearer (adversarial Л)', async () => {
    // A phone-sized line: weeks some 6 px apart, an exchange on the Monday after the week to 22 Feb.
    const weeks = Array.from({ length: 51 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 9, 12) + index * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10)
      return { day, rate: rate('4.50', day), x: index * 20, level: 500 }
    })
    const monday = point('a0000000-0000-4000-8000-000000000010', weeks[20]?.day ?? '', 20, 403, {
      level: 900,
    })
    const { view, area } = chart([rouble({ steps: weeks, exchanges: [monday] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    // The dot's centre: 403 × 0.3 = 120.9 px across, (1000 − 50 − 810) × 0.18 = 25.2 px down.
    for (const dx of [-4.5, -2, 0, 2, 4.5]) {
      await at(view, area, 0, 0)
      expect(view.find('.mine').exists()).toBe(false)
      await at(view, area, 120.9 + dx, 25.2)
      expect(view.find('.mine-place').text()).toContain('Ардшинбанк')
    }
  })

  it('dots of two days drawn as one are turned over by a second tap too (adversarial М, review 6)', async () => {
    // A day apart at one rate: some 0,9 px across — one spot on the screen.
    const first = point('a0000000-0000-4000-8000-000000000011', '2026-02-24', 3, 571, {
      place: 'Вторник',
    })
    const second = point('a0000000-0000-4000-8000-000000000012', '2026-02-25', 3, 574, {
      place: 'Среда',
      level: 410,
    })
    const { view, area } = chart([rouble({ exchanges: [first, second] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    expect(view.find('.mine-place').text()).toContain('Среда')
    const seen = new Set<string>()
    for (let tap = 0; tap < 4; tap += 1) {
      await at(view, area, 171.6, 106)
      seen.add(view.find('.mine-place').text().split(' · ')[0] ?? '')
    }
    expect([...seen].sort()).toEqual(['Вторник', 'Среда'])
  })

  it('three exchanges on one spot go round all three by taps (adversarial О, review 7)', async () => {
    // One day at one rate — one centre; three days running — centres within 2 px.
    const spots = {
      'one day': [
        ['2026-02-24', 571],
        ['2026-02-24', 571],
        ['2026-02-24', 571],
      ],
      'three days running': [
        ['2026-02-23', 568],
        ['2026-02-24', 571],
        ['2026-02-25', 574],
      ],
    } as const
    for (const [label, spot] of Object.entries(spots)) {
      const exchanges = spot.map(([day, x], index) =>
        point(`a0000000-0000-4000-8000-00000000002${String(index)}`, day, 3, x, {
          place: `Касса ${String(index + 1)}`,
        }),
      )
      const { view, area } = chart([rouble({ exchanges })])
      area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
      const seen = new Set<string>()
      for (let tap = 0; tap < 6; tap += 1) {
        await at(view, area, 171.3, 106.2)
        seen.add(view.find('.mine-place').text().split(' · ')[0] ?? '')
      }
      expect([...seen].sort(), label).toEqual(['Касса 1', 'Касса 2', 'Касса 3'])
    }
  })

  it('three dots 2,7 px apart: the first tap is the one under the finger, then round them all (П)', async () => {
    const dots = [
      ['a0000000-0000-4000-8000-000000000031', '2026-02-21', 2, 562, 'Первый'],
      ['a0000000-0000-4000-8000-000000000032', '2026-02-24', 3, 571, 'Второй'],
      ['a0000000-0000-4000-8000-000000000033', '2026-02-27', 3, 580, 'Третий'],
    ] as const
    const exchanges = dots.map(([id, day, week, x, place]) => point(id, day, week, x, { place }))
    const { view, area } = chart([rouble({ exchanges })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const shown = () => view.find('.mine-place').text().split(' · ')[0]
    expect(shown()).toBe('Третий')
    // Right on «Второй»: it, then its neighbours, then it again.
    const round: (string | undefined)[] = []
    for (let tap = 0; tap < 4; tap += 1) {
      await at(view, area, 171.3, 106.2)
      round.push(shown())
    }
    // Its two neighbours stand 2,7 px off either way: which comes first is a tie.
    expect(round[0]).toBe('Второй')
    expect(new Set(round.slice(0, 3))).toEqual(new Set(['Первый', 'Второй', 'Третий']))
    expect(round[3]).toBe('Второй')
    // Away from the spot and back right on «Первый»: a new round, it first.
    await at(view, area, 20, 20)
    await at(view, area, 168.6, 106.2)
    expect(shown()).toBe('Первый')
  })

  it('a tap on a neighbour 6,3 px off is a new spot, not the next of the round (adversarial С)', async () => {
    // Weekly at one rate: centres 6,3 px apart — inside a ring of the first tap, yet seen apart.
    const dots = [
      ['a0000000-0000-4000-8000-000000000041', '2026-02-17', 2, 550, 'Первый'],
      ['a0000000-0000-4000-8000-000000000042', '2026-02-24', 3, 571, 'Второй'],
      ['a0000000-0000-4000-8000-000000000043', '2026-03-03', 4, 592, 'Третий'],
    ] as const
    const exchanges = dots.map(([id, day, week, x, place]) => point(id, day, week, x, { place }))
    const { view, area } = chart([rouble({ exchanges })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const shown = () => view.find('.mine-place').text().split(' · ')[0]
    await at(view, area, 171.3, 106.2)
    expect(shown()).toBe('Второй')
    await at(view, area, 177.6, 106.2)
    expect(shown()).toBe('Третий')
    await at(view, area, 165, 106.2)
    expect(shown()).toBe('Первый')
  })

  it('three on one spot go round all three wherever on the spot the finger lands (review 8)', async () => {
    const exchanges = [1, 2, 3].map((n) =>
      point(`a0000000-0000-4000-8000-00000000005${String(n)}`, '2026-02-24', 3, 571, {
        place: `Касса ${String(n)}`,
      }),
    )
    const { view, area } = chart([rouble({ exchanges })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const seen = new Set<string>()
    // Five pixels off the centre (171,3; 106,2), a little elsewhere every time.
    for (const [x, y] of [
      [176.3, 106.2],
      [171.3, 111.2],
      [167.3, 103.2],
      [175.3, 109.2],
      [168.3, 102.2],
      [171.3, 101.2],
    ]) {
      await at(view, area, x ?? 0, y ?? 0)
      seen.add(view.find('.mine-place').text().split(' · ')[0] ?? '')
    }
    expect([...seen].sort()).toEqual(['Касса 1', 'Касса 2', 'Касса 3'])
  })

  it('must not fire: taps again on a dot seen apart keep it (adversarial Т)', async () => {
    const dots = [
      ['a0000000-0000-4000-8000-000000000061', '2026-02-17', 2, 550, 'Первый'],
      ['a0000000-0000-4000-8000-000000000062', '2026-02-24', 3, 571, 'Второй'],
      ['a0000000-0000-4000-8000-000000000063', '2026-03-03', 4, 592, 'Третий'],
    ] as const
    const exchanges = dots.map(([id, day, week, x, place]) => point(id, day, week, x, { place }))
    const { view, area } = chart([rouble({ exchanges })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    for (let tap = 0; tap < 3; tap += 1) {
      await at(view, area, 171.3, 106.2)
      expect(view.find('.mine-place').text()).toContain('Второй')
    }
  })

  it('a new answer begins the round afresh: the dot now under the finger (adversarial Р)', async () => {
    const one = point('a0000000-0000-4000-8000-000000000044', '2026-02-24', 3, 571, {
      place: 'Касса 1',
    })
    const two = point('a0000000-0000-4000-8000-000000000045', '2026-02-24', 3, 571, {
      place: 'Касса 2',
    })
    const far = point('a0000000-0000-4000-8000-000000000046', '2026-02-24', 3, 571, {
      place: 'Дальний',
      level: 700,
    })
    const { view, area } = chart([rouble({ exchanges: [one, two, far] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    await at(view, area, 171.3, 106.2)
    expect(view.find('.mine-place').text()).toContain('Касса 1')
    // The scale grew: «Дальний» came down onto the spot, the tills went 20 px lower.
    await view.setProps({
      chart: {
        pairs: [
          rouble({
            exchanges: [
              { ...one, level: 290 },
              { ...two, level: 290 },
              { ...far, level: 400 },
            ],
          }),
        ],
      },
    })
    await at(view, area, 171.3, 106.2)
    expect(view.find('.mine-place').text()).toContain('Дальний')
  })

  it('a chain of dots 7 px apart: a tap and a slide choose the one under the finger (adversarial Н)', async () => {
    // One place, one rate, every eight days: centres 7,2 px apart on 300 px, each overlapping the next.
    const chain = [
      ['a0000000-0000-4000-8000-000000000015', '2026-02-20', 2, 547, 'Первый'],
      ['a0000000-0000-4000-8000-000000000016', '2026-02-24', 3, 571, 'Второй'],
      ['a0000000-0000-4000-8000-000000000017', '2026-02-28', 3, 595, 'Третий'],
    ] as const
    const exchanges = chain.map(([id, day, week, x, place]) => point(id, day, week, x, { place }))
    const { view, area } = chart([rouble({ exchanges })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    const shown = () => view.find('.mine-place').text().split(' · ')[0]
    expect(shown()).toBe('Третий')
    // The middle one's centre: 571 × 0.3 = 171,3 px across, (1000 − 50 − 360) × 0.18 = 106,2 down.
    await at(view, area, 171.3, 106.2)
    expect(shown()).toBe('Второй')
    // A slide from left of the first to the last shows each in turn.
    const event = (type: string, x: number) =>
      new PointerEvent(type, { clientX: x, clientY: 106.2, pointerType: 'touch', bubbles: true })
    const seen: string[] = []
    area.dispatchEvent(event('pointerdown', 150))
    for (let x = 160; x <= 180; x += 0.5) {
      area.dispatchEvent(event('pointermove', x))
      await view.vm.$nextTick()
      const place = shown()
      if (place && seen.at(-1) !== place) seen.push(place)
    }
    area.dispatchEvent(event('pointerup', 180))
    expect(seen.slice(-3)).toEqual(['Первый', 'Второй', 'Третий'])
  })

  it('must not fire: two dots a finger apart but drawn apart are not turned over', async () => {
    // One day, 4,25 and 4,40: the dots stand some 30 px apart.
    const low = point('a0000000-0000-4000-8000-000000000013', '2026-02-24', 3, 571, {
      place: 'Утро',
      level: 300,
    })
    const high = point('a0000000-0000-4000-8000-000000000014', '2026-02-24', 3, 571, {
      place: 'Вечер',
      level: 500,
    })
    const { view, area } = chart([rouble({ exchanges: [low, high] })])
    area.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 180 }) as DOMRect
    // «Вечер» at (1000 − 50 − 450) × 0.18 = 90 px; tapped on it twice, it stays.
    await at(view, area, 171.3, 90)
    await at(view, area, 171.3, 90)
    expect(view.find('.mine-place').text()).toContain('Вечер')
  })

  it('must not fire: a scroll that started on the chart chooses nothing', async () => {
    const { view, area } = chart()
    area.dispatchEvent(touch('pointerdown', 3, 50))
    area.dispatchEvent(touch('pointermove', 5, 120))
    area.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' }))
    area.dispatchEvent(touch('pointerup', 5, 120))
    await view.vm.$nextTick()
    expect(view.find('.mine-rate').text()).toContain('28 февр.')
  })

  it('a radio for every week with no exchange and for every exchange, each saying itself (Р-6)', async () => {
    const { view } = chart()
    const radios = view.findAll('.chart input[type="radio"]')
    // Weeks 1, 3 and 5 have none; the second has two, the fourth one.
    expect(radios).toHaveLength(6)
    expect(radios[0]?.attributes('aria-label')).toBe('Неделя по 8 февраля: рынок 4,90 ֏/₽')
    expect(radios[2]?.attributes('aria-label')).toBe(
      'Неделя по 15 февраля: рынок 4,80 ֏/₽; мой обмен 14 февраля: 4,58 ֏/₽, без сравнения',
    )
    expect(radios[3]?.attributes('aria-label')).toBe('Неделя по 22 февраля: рынка нет')
    expect(plain(radios[4]?.attributes('aria-label'))).toBe(
      'Неделя по 1 марта: рынок 4,60 ֏/₽; мой обмен 28 февраля: 4,58 ֏/₽, −0,40 %',
    )
    expect((radios[4]?.element as HTMLInputElement).checked).toBe(true)
    await radios[3]?.setValue(true)
    expect(view.find('.figure').text()).toBe('Рынка за эту неделю нет')
  })

  it('breaks the line where a week has no figure, never drawing a zero', () => {
    const { view } = chart()
    expect(view.findAll('polyline.line').map((line) => line.attributes('points'))).toEqual([
      '0,50 250,230',
      '750,545 1000,950',
    ])
  })

  it('draws a week with a figure between two gaps as a dot of the line (adversarial Д)', () => {
    // Figures in the first, the third and the last week, a gap between each.
    const weeks = year().steps.map((week, index) =>
      index % 2 === 1
        ? { ...week, rate: null, level: null }
        : { ...week, rate: rate('4.70', week.day), level: 600 },
    )
    const { view } = chart([rouble({ steps: weeks, exchanges: [] })])
    expect(view.findAll('polyline.line')).toHaveLength(0)
    expect(view.findAll('.lone').map((dot) => dot.attributes('x1'))).toEqual(['0', '500', '1000'])
  })

  it('draws a mark to the market of the exchange only where it had one (В-1)', () => {
    const { view } = chart()
    // Two measured exchanges, a line and its end each.
    expect(view.findAll('.mark')).toHaveLength(4)
    expect(view.findAll('.point')).toHaveLength(3)
  })

  it('prints the ticks of the axis as the server laid them, two digits or whole', () => {
    expect(
      chart()
        .view.findAll('.level')
        .map((tick) => tick.text()),
    ).toEqual(['4,30', '4,60', '4,90'])
    expect(
      chart([dollar])
        .view.findAll('.level')
        .map((tick) => tick.text()),
    ).toEqual(['389'])
  })

  it('names the first month, every third after it, and the last only two past a label', () => {
    // February and March: March is one month past February, and the two would run together.
    const months = chart().view.findAll('.month')
    expect(months.map((month) => month.text())).toEqual(['фев'])
  })

  it('has no switch for one pair; with two it switches and starts the choice afresh', async () => {
    expect(chart().view.find('.pairs').exists()).toBe(false)
    const { view } = chart([rouble(), dollar])
    const segments = view.findAll('.pairs input')
    expect(view.find('.pairs').text()).toContain('₽ и ֏')
    await segments[1]?.setValue(true)
    expect(view.find('h2').text()).toBe('Курс доллара за 12 месяцев')
    expect(view.find('.none').text()).toBe('Обменов за 12 месяцев не было')
    expect(view.find('.figure').text()).toBe('392,00 ֏/$')
  })

  it('a line with no exchanges says there were none in twelve months', () => {
    const { view } = chart([rouble({ exchanges: [] })])
    expect(view.find('.none').text()).toBe('Обменов за 12 месяцев не было')
    expect(view.findAll('.point')).toHaveLength(0)
  })
})

/**
 * The month by days, 27 February to 4 March — a weekend at Friday's figure — with the exchange of
 * 28 February the year has too, and one of 3 March the year was not given.
 */
function month(of: Partial<Period> = {}): Period {
  const days = ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']
  const friday = rate('4.62', '2026-02-27')
  return {
    step: 'day',
    steps: days.map((day, index) => ({
      day,
      rate: index < 3 ? friday : rate('4.55', day),
      x: index * 200,
      level: index < 3 ? 700 : 300,
    })),
    exchanges: [
      point('a0000000-0000-4000-8000-000000000003', '2026-02-28', 1, 200),
      point('a0000000-0000-4000-8000-000000000099', '2026-03-03', 4, 800, { place: 'Обменник' }),
    ],
    levels: [{ rate: rate('4.60', '2026-03-04'), level: 500 }],
    ...of,
  }
}

describe('ExchangeRateChart by period (MOL-168)', () => {
  it('offers the three periods even for one pair, the year by default, the title following', () => {
    const { view } = chart()
    expect(view.find('.pairs').exists()).toBe(false)
    expect(view.findAll('.periods label').map((label) => label.text())).toEqual([
      'Месяц',
      '6 месяцев',
      '12 месяцев',
    ])
    expect(view.find<HTMLInputElement>('.periods input:checked').element.value).toBe('12')
    expect(view.find('h2').text()).toBe('Курс рубля за 12 месяцев')
  })

  it('asks the screen for a period and draws none of it itself: the period is the address', async () => {
    const { view } = chart([rouble({}, { 1: month() })])
    await view.findAll('.periods input')[0]?.setValue(true)
    expect(view.emitted('update:months')).toEqual([[1]])
    expect(view.find('h2').text()).toBe('Курс рубля за 12 месяцев')
  })

  it('reads the month by days, and keeps the exchange chosen in the year (Р-6)', async () => {
    const { view, area } = chart([rouble({}, { 1: month() })])
    // 28 February chosen by hand in the year: 714 × 0.3 px across.
    await tap(view, area, 214)
    expect(view.find('.mine-rate').text()).toContain('28 февр.')
    await view.setProps({ months: 1 })
    expect(view.find('h2').text()).toBe('Курс рубля за месяц')
    expect(reading(view)).toContain(`${calendarDayOf('2026-02-28')} · рынок`)
    expect(view.find('.figure').text()).toBe('4,62 ֏/₽')
    expect(view.find('.mine-rate').text()).toContain('28 февр.')
    expect(view.find('.note').text()).toContain('Коснитесь графика — покажем день')
    // Four days with no exchange and two exchanges: a radio each.
    expect(view.findAll('.chart input[type="radio"]')).toHaveLength(6)
  })

  it('opens a period that lacks the chosen exchange on its own latest', () => {
    const { view } = chart([rouble({}, { 1: month() })], 1)
    expect(view.find('.mine-place').text()).toContain('Обменник')
  })

  it('says a day of the month with no exchange is a day, and speaks it so', async () => {
    const { view, area } = chart([rouble({}, { 1: month() })], 1)
    await tap(view, area, 0)
    expect(reading(view)).toContain(`${calendarDayOf('2026-02-27')} · рынок`)
    expect(view.find('.none').text()).toBe('В этот день обменов не было')
    const spoken = view.findAll('.chart input').map((radio) => radio.attributes('aria-label'))
    expect(spoken[0]).toBe(`${calendarDay('2026-02-27', 'ru')}: рынок 4,62 ֏/₽`)
  })

  it('names the Mondays of the month under the line, and half a year every month', () => {
    const days = chart([rouble({}, { 1: month() })], 1).view.findAll('.month')
    expect(days.map((label) => label.text())).toEqual([calendarDayOf('2026-03-02')])
    const months = chart([rouble({}, { 6: year() })], 6).view.findAll('.month')
    expect(months.map((label) => label.text())).toEqual(['фев', 'мар'])
  })

  it('keeps the card and its controls in a period with no market, and says so (Р-6)', () => {
    const { view } = chart([rouble()], 6)
    expect(view.find('h2').text()).toBe('Курс рубля за 6 месяцев')
    expect(view.find('.none').text()).toBe('Рынка за 6 месяцев нет')
    expect(view.find('.periods').exists()).toBe(true)
    expect(view.find('fieldset.chart').exists()).toBe(false)
    expect(view.find('.chart-empty').exists()).toBe(true)
    // The note speaks of the line and a tap on it: with no chart it goes (review 3).
    expect(view.find('.note').exists()).toBe(false)
  })

  it('names no month of half a year whose tail alone the window holds next to the next (review 1, А)', () => {
    // From Sunday the 26th of April: May begins a week in, 38 thousandths on.
    const days = ['2026-04-26', '2026-05-03', '2026-05-31', '2026-06-28', '2026-07-26']
    const steps = days.map((day, index) => ({
      day,
      rate: rate('4.50', day),
      x: [0, 38, 191, 344, 497][index] ?? 0,
      level: 500,
    }))
    const { view } = chart([rouble({}, { 6: year({ steps, exchanges: [] }) })], 6)
    expect(view.findAll('.month').map((label) => label.text())).toEqual(['май', 'июн', 'июл'])
  })

  it('centres a name on its day, and lays it from an end only next to it (review 2, Б)', () => {
    // The month's only Monday, the 2nd of March, is 600 thousandths on: centred.
    const monday = chart([rouble({}, { 1: month() })], 1).view.find('.month')
    expect(monday.classes()).toEqual(['month'])
    // The year's first name stands at its very beginning: laid from it.
    const february = chart().view.find('.month')
    expect(february.classes()).toContain('start')
  })

  it('a month with no exchange of the pair says there were none in it', () => {
    const { view } = chart([rouble({}, { 1: month({ exchanges: [] }) })], 1)
    expect(view.find('.none').text()).toBe('Обменов за месяц не было')
    expect(view.findAll('.point')).toHaveLength(0)
  })
})
