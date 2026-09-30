import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import TripTotal from '@/components/TripTotal.vue'

interface Wire {
  readonly amount: string
  readonly currency: 'AMD' | 'RUB' | 'USD' | 'EUR'
}

interface Over {
  readonly total?: readonly Wire[]
  readonly converted?: { amount: string; currency: 'RUB' } | null
  readonly rate?: string | null
  /** «Сумма по чеку» (MOL-78) and what the server says of the prices beside it. */
  readonly receipt?: Wire | null
  readonly prices?: readonly Wire[]
  readonly gap?: { kind: 'unpriced' | 'over' | 'under'; amount: Wire } | null
  /** The purchases: a price each, or none. */
  readonly rows?: readonly (Wire | null)[]
}

const row = (amount: Wire | null, n: number) => ({
  id: `eeeeeeee-0000-4000-8000-${String(n).padStart(12, '0')}`,
  createdAt: '2026-09-19T08:05:00.000Z',
  item: {
    id: `dddddddd-0000-4000-8000-${String(n).padStart(12, '0')}`,
    kind: 'product',
    name: `Товар ${String(n)}`,
    note: null,
    defaultUnit: 'piece',
    typicalQuantity: null,
  },
  quantity: null,
  amount,
  unitPrice: null,
})

function trip(over: Over = {}): TripView {
  return tripViewCodec.parse({
    id: 'bbbbbbbb-0000-4000-8000-000000000001',
    startedAt: '2026-09-19T08:00:00.000Z',
    finishedAt: null,
    currency: 'AMD',
    rate:
      over.rate === null
        ? null
        : {
            base: 'RUB',
            quote: 'AMD',
            rate: over.rate ?? '4.82',
            source: 'official',
            asOf: '2026-01-15T12:00:00.000Z',
          },
    rateProvider: over.rate === null ? null : 'cba',
    rateJump: null,
    rateStale: false,
    place: {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      kind: 'store',
      name: 'Ереван Сити',
    },
    expenses: (over.rows ?? []).map(row),
    total: over.total ?? [{ amount: '6493.12', currency: 'AMD' }],
    converted: over.converted === undefined ? { amount: '1347', currency: 'RUB' } : over.converted,
    receipt: over.receipt ?? null,
    prices: over.prices ?? [],
    gap: over.gap ?? null,
  })
}

/** Прочитанное с экрана: деньги печатаются с неразрывным пробелом, тесты — обычным. */
const plain = (found: { text: () => string }): string => found.text().replaceAll('\u00a0', ' ')

function render(props: Record<string, unknown> = {}) {
  return mount(TripTotal, {
    props: { trip: trip(), ...props },
    global: { plugins: [createAppI18n('ru')] },
  })
}

describe('TripTotal', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('сумма похода крупно, пересчёт рядом со знаком «≈» и датой курса', () => {
    const view = render()
    expect(plain(view)).toContain('6 493,12 ֏')
    expect(plain(view)).toContain('≈ 1 347 ₽')
    expect(plain(view)).toContain('курс 4,82 ֏/₽ · 15 янв.')
  })

  it('свой курс из обменов подписан как свой, а не как курс банка (MOL-40)', () => {
    const own = trip()
    const view = render({
      trip: { ...own, rate: own.rate && { ...own.rate, source: 'personal' }, rateProvider: null },
    })
    expect(plain(view)).toContain('мой курс 4,82 ֏/₽ · 15 янв.')
    expect(plain(view)).not.toContain('ЦБ')
  })

  // Прыжок запятой через единицу: строка под суммой — той же стороной, что заметка и шторка
  // (ревью Т-11, адв. А‴), и день курса — днём Еревана, в UTC тоже (адв. Ж″).
  it('после прыжка через единицу курс под суммой — стороной прежнего, день — днём Еревана', () => {
    const rate = (value: string) => ({
      base: 'RUB' as const,
      quote: 'AMD' as const,
      scaled: BigInt(Math.round(Number(value) * 1_000_000)),
      source: 'official' as const,
      // Полночь Еревана 26 сентября — вечер 25-го в UTC.
      asOf: new Date('2026-09-25T20:00:00.000Z'),
    })
    const jumped = rate('0.043')
    const view = render({
      trip: {
        ...trip(),
        rate: jumped,
        rateJump: { jumped, previous: rate('4.305'), manual: null, choice: null },
      },
    })
    expect(plain(view)).toContain('курс 0,043 ֏/₽ · 26 сент.')
    expect(plain(view)).not.toContain('₽/֏')
  })

  it('до переворота крупное число — факт, без признаков оценки', () => {
    const view = render()
    expect(view.get('.sum').classes()).not.toContain('guess')
  })

  it('без курса пересчёта нет и переворачивать нечего', () => {
    const view = render({ trip: trip({ rate: null, converted: null }) })
    expect(view.text()).not.toContain('≈')
    expect(view.find('button').exists()).toBe(false)
  })

  it('тап переворачивает, «≈» остаётся на пересчёте, и выбор помнится', async () => {
    const view = render()
    await view.get('button').trigger('click')

    // Крупным стал рубль, но признаки оценки с него не снялись: «≈» и приглушённый цвет.
    expect(plain(view.get('.sum'))).toBe('≈ 1 347 ₽')
    expect(view.get('.sum').classes()).toContain('guess')
    expect(plain(view.get('.rest'))).toContain('6 493,12 ֏')

    const again = render()
    expect(plain(again.get('.sum'))).toBe('≈ 1 347 ₽')
  })

  it('чужая валюта — строкой ниже, и пересчёт честно говорит, что покрывает не всё', () => {
    const view = render({
      trip: trip({
        total: [
          { amount: '6493.12', currency: 'AMD' },
          { amount: '1500', currency: 'RUB' },
        ],
      }),
    })

    expect(plain(view.get('.sum'))).toBe('6 493,12 ֏')
    expect(plain(view.get('.rest'))).toContain('1 500,00 ₽')
    expect(view.text()).toContain('пересчёт только по AMD')
  })

  it('пока очередь не пуста, у итога есть оговорка — иначе он тихо меньше корзины', () => {
    const view = render({ pending: 2 })
    expect(view.text()).toContain('+ 2 позиции ещё не ушли')
  })

  it('поход, который ещё не ушёл: итога нет и сказано почему', () => {
    const view = render({ trip: null, local: true })
    expect(view.get('.sum').text()).toBe('—')
    expect(view.text()).toContain(ru.trip.caveat.local)
  })

  it('нет ни одной цены — прочерк, а не ноль', () => {
    const view = render({ trip: trip({ total: [], converted: null }) })
    expect(view.get('.sum').text()).toBe('—')
  })

  describe('сумма по чеку (MOL-78)', () => {
    const amd = (amount: string): Wire => ({ amount, currency: 'AMD' })
    /** 7 из 12 с ценой на 8 300 ֏, чек на 12 400 ֏. */
    const partial = () =>
      trip({
        total: [amd('12400')],
        receipt: amd('12400'),
        prices: [amd('8300')],
        gap: { kind: 'unpriced', amount: amd('4100') },
        converted: null,
        rows: [...Array.from({ length: 7 }, () => amd('1185.71')), null, null, null, null, null],
      })

    it('главная цифра — сумма чека, под ней «с ценой 7 из 12» и «без цены 5» с суммами сервера (В-2)', () => {
      const view = render({ trip: partial() })
      expect(view.get('.caption').text()).toBe(ru.trip.receipt.total)
      expect(plain(view.get('.sum'))).toBe('12 400,00 ֏')
      const lines = view.findAll('.split li').map((line) => line.findAll('span').map(plain))
      expect(lines).toEqual([
        ['С ценой — 7 из 12', '8 300,00 ֏'],
        ['Без цены — 5', '4 100,00 ֏'],
      ])
    })

    it('цены больше чека — строка-предупреждение, не отказ; всё сошлось — строк нет', () => {
      const over = render({
        trip: trip({
          total: [amd('9870')],
          receipt: amd('9870'),
          prices: [amd('10170')],
          gap: { kind: 'over', amount: amd('300') },
          rows: [amd('10170')],
        }),
      })
      expect(plain(over.get('.split .warn'))).toContain('Цены больше чека на 300,00 ֏')

      const even = render({
        trip: trip({
          total: [amd('500')],
          receipt: amd('500'),
          prices: [amd('500')],
          rows: [amd('500')],
        }),
      })
      expect(even.findAll('.split li span').map(plain)).toEqual(['С ценой — 1 из 1', '500,00 ֏'])
    })

    it('без суммы — «Итого» как было, и «+ Сумма по чеку» только когда её предлагают (В-1)', async () => {
      const offered = render({ offerReceipt: true })
      expect(offered.get('.caption').text()).toBe(ru.trip.total)
      expect(offered.find('.split').exists()).toBe(false)
      await offered.get('.receipt').trigger('click')
      expect(offered.emitted('receipt')).toHaveLength(1)

      expect(render().find('.receipt').exists()).toBe(false)
      expect(render({ trip: partial() }).get('.receipt').text()).toBe(ru.trip.receipt.edit)
    })

    it('запись из памяти телефона — суммы не знает: ни «+», ни «Изменить» (ревью 4)', () => {
      const cached = render({
        trip: trip({ total: [amd('1400')] }),
        offerReceipt: true,
        receiptKnown: false,
      })
      expect(cached.find('.receipt').exists()).toBe(false)
      expect(cached.find('.split').exists()).toBe(false)
    })

    it('сумма в очереди — строка «отправляется», итог остаётся серверным (Р-7)', () => {
      const typed = render({ receiptWaiting: { receipt: { minor: 1_240_000n, currency: 'AMD' } } })
      expect(plain(typed.get('.sum'))).toBe('6 493,12 ֏')
      expect(plain(typed.get('.waiting'))).toBe('Сумма по чеку 12 400,00 ֏ · отправляется')
      expect(typed.get('.receipt').text()).toBe(ru.trip.receipt.edit)

      const off = render({ trip: partial(), receiptWaiting: { receipt: null } })
      expect(off.get('.waiting').text()).toBe(ru.trip.receipt.removing)
    })
  })
})
