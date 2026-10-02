import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { parseRate, yerevanMidnight } from '@molvia/model'
import type { ExchangeRate, ExchangeRateChartView } from '@molvia/model'
import ExchangeRateChart from './ExchangeRateChart.vue'
import { createAppI18n } from '@/i18n'

type Pair = ExchangeRateChartView['pairs'][number]
type Point = Pair['exchanges'][number]

function rate(value: string, day: string, base: Pair['currency'] = 'RUB'): ExchangeRate {
  return {
    base,
    quote: 'AMD',
    scaled: parseRate(value),
    source: 'official',
    asOf: yerevanMidnight(day),
  }
}

function point(id: string, day: string, week: number, x: number, of: Partial<Point> = {}): Point {
  return {
    id,
    day,
    week,
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
 * Four weeks from 8 February to 8 March, a day 1000 / 28 of the card — every x by its day, as the
 * server lays it — the third week with no figure, two exchanges in the second.
 */
function rouble(of: Partial<Pair> = {}): Pair {
  return {
    currency: 'RUB',
    side: 'bankBuys',
    weeks: [
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
  weeks: [
    { day: '2026-02-08', rate: rate('386', '2026-02-06', 'USD'), x: 0, level: 0 },
    { day: '2026-03-04', rate: rate('392', '2026-03-04', 'USD'), x: 1000, level: 1000 },
  ],
  exchanges: [],
  levels: [{ rate: rate('389', '2026-03-04', 'USD'), level: 500 }],
}

function chart(pairs: Pair[] = [rouble()]) {
  const view = mount(ExchangeRateChart, {
    props: { chart: { pairs } },
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
    const radios = view.findAll('input[type="radio"]')
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
    const weeks = rouble().weeks.map((week, index) =>
      index % 2 === 1
        ? { ...week, rate: null, level: null }
        : { ...week, rate: rate('4.70', week.day), level: 600 },
    )
    const { view } = chart([rouble({ weeks, exchanges: [] })])
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
