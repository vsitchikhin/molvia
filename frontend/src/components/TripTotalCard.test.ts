import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { tripViewCodec } from '@molvia/model'
import type { TripView } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import TripTotalCard from '@/components/TripTotalCard.vue'

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

// Итог ручной записи карточкой под списком (MOL-206, В-17 «а»): то же, что говорила полоса, одной
// строкой частей, и переворот — нажатием на всю карточку.
describe('TripTotalCard', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  const amd = (amount: string): Wire => ({ amount, currency: 'AMD' })

  function card(props: Record<string, unknown> = {}) {
    return mount(TripTotalCard, {
      props: { trip: trip(), ...props },
      global: { plugins: [createAppI18n('ru')] },
    })
  }

  const parts = (view: ReturnType<typeof card>) => view.findAll('.line .part').map(plain)

  it('сумма крупно, а под ней одной строкой — ≈ в валюте дохода и курс с датой', () => {
    const view = card()
    expect(view.get('.caption').text()).toBe(ru.trip.total)
    expect(plain(view.get('.sum'))).toBe('6 493,12 ֏')
    expect(parts(view)).toEqual(['≈ 1 347 ₽', 'курс 4,82 ֏/₽', '15 янв.'])
  })

  it('«С ценой — n из m · без цены — k» — по строкам экрана, только когда цена есть не у всех', () => {
    const some = card({
      trip: trip({ total: [amd('1000')], rows: [amd('1000'), null] }),
      rows: { kept: 2, unpriced: 1 },
    })
    expect(parts(some).slice(0, 2)).toEqual(['С ценой — 1 из 2', 'без цены — 1'])

    const all = card({ trip: trip({ total: [amd('1000')] }), rows: { kept: 1, unpriced: 0 } })
    expect(parts(all).some((part) => part.startsWith('С ценой'))).toBe(false)
    // Строка без цены удаляется без связи: сервер её ещё держит, экран — уже нет (адверсариальное А2).
    const removing = card({
      trip: trip({ total: [amd('1000')], rows: [amd('1000'), null] }),
      rows: { kept: 1, unpriced: 0 },
    })
    expect(parts(removing).some((part) => part.startsWith('С ценой'))).toBe(false)
  })

  it('вся карточка — кнопка переворота: «≈» остаётся на пересчёте, точная сумма уходит в строку', async () => {
    const view = card()
    const face = view.get('button.face')
    expect(face.attributes('aria-pressed')).toBe('false')
    // Скрытое имя действия первым, а не aria-label: цифры и оговорки остаются слышны.
    expect(face.attributes('aria-label')).toBeUndefined()
    expect(face.get('.hidden').text()).toBe(ru.trip.flip)

    await face.trigger('click')
    expect(face.attributes('aria-pressed')).toBe('true')
    expect(plain(view.get('.sum'))).toBe('≈ 1 347 ₽')
    expect(view.get('.sum').classes()).toContain('guess')
    // Точная сумма — строкой под оценкой, курс — в строке частей.
    expect(plain(view.findAll('.line')[0] ?? view.get('.line'))).toBe('6 493,12 ֏')
    expect(parts(view)).toEqual(['курс 4,82 ֏/₽', '15 янв.'])

    // Выбор помнится: одна память на телефон, для записи и записанных покупок.
    expect(plain(card().get('.sum'))).toBe('≈ 1 347 ₽')
  })

  it('строка рвётся только между частями: у курса, дня и «≈» пробелы неразрывные (ревью 3, №2)', () => {
    const raw = card({ rows: { kept: 2, unpriced: 1 } })
      .findAll('.line .part')
      .map((part) => part.text())
    expect(raw.length).toBeGreaterThan(2)
    for (const part of raw) expect(part, part).not.toContain(' ')
  })

  it('строки, что карточка режет по «·», в обоих словарях делятся одинаково и не теряют подстановок (ревью 4, №1)', () => {
    const keys = ['total_line', 'rate_line', 'rate_line_source', 'rate_line_mine'] as const
    for (const key of keys) {
      const [mine, theirs] = [ru.trip[key], en.trip[key]].map((line) => line.split(' · '))
      expect(theirs?.length, key).toBe(mine?.length)
      // Каждая часть — со своей подстановкой: «·» стоит между кусками, а не внутри одного.
      for (const part of [...(mine ?? []), ...(theirs ?? [])]) expect(part, key).toMatch(/\{\w+\}/)
    }
    // Части строки чека — каждая одна часть (ревью №3): «·» внутри развалил бы её молча, а подстановки
    // у обоих словарей одни.
    const lines = Object.keys(ru.trip.receipt).filter((key) => key.startsWith('line_'))
    expect(lines.length).toBeGreaterThan(0)
    const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((found) => found[1]).sort()
    for (const key of lines) {
      const [mine, theirs] = [ru, en].map(
        (book) => (book.trip.receipt as Record<string, unknown>)[key],
      )
      expect(typeof theirs, key).toBe('string')
      for (const line of [mine, theirs] as string[]) expect(line, key).not.toContain(' · ')
      expect(slots(theirs as string), key).toEqual(slots(mine as string))
    }
  })

  it('свой курс из обменов подписан как свой, а не как курс банка (MOL-40)', () => {
    const own = trip()
    const view = card({
      trip: { ...own, rate: own.rate && { ...own.rate, source: 'personal' }, rateProvider: null },
    })
    expect(parts(view)).toContain('мой курс 4,82 ֏/₽')
    expect(plain(view)).not.toContain('ЦБ')
  })

  it('курс НБ Сербии назван рядом с числом — так требуют условия НБС (MOL-230, ревью 1)', () => {
    const own = trip()
    const dinar = {
      ...own,
      currency: 'RSD' as const,
      rate: own.rate && { ...own.rate, quote: 'RSD' as const, scaled: 1_225_700n },
      rateProvider: 'nbs' as const,
    }
    expect(parts(card({ trip: dinar }))).toEqual([
      '≈ 1 347 ₽',
      'курс 1,23 RSD/₽',
      '15 янв.',
      'НБ Сербии',
    ])
    // ЦБ РА и запасной под строкой не называются: у них своё место — заметка курса.
    expect(plain(card())).not.toContain('ЦБ РА')
    const mine = { ...dinar, rate: dinar.rate && { ...dinar.rate, source: 'personal' as const } }
    expect(plain(card({ trip: { ...mine, rateProvider: null } }))).not.toContain('НБ Сербии')
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
    const view = card({
      trip: {
        ...trip(),
        rate: jumped,
        rateJump: { jumped, previous: rate('4.305'), manual: null, choice: null },
      },
    })
    expect(parts(view)).toContain('курс 0,043 ֏/₽')
    expect(parts(view)).toContain('26 сент.')
    expect(plain(view)).not.toContain('₽/֏')
  })

  it('до переворота крупное число — факт, без признаков оценки', () => {
    expect(card().get('.sum').classes()).not.toContain('guess')
  })

  it('нет ни одной цены — прочерк, а не ноль', () => {
    const view = card({ trip: trip({ total: [], converted: null }) })
    expect(view.get('.sum').text()).toBe('—')
  })

  it('без курса переворачивать нечего — карточка не кнопка', () => {
    const view = card({ trip: trip({ rate: null, converted: null }) })
    expect(view.find('button').exists()).toBe(false)
    expect(view.text()).not.toContain('≈')
  })

  it('прочие валюты — своей строкой под суммой, не соседом оценки; оговорки остаются', () => {
    const view = card({
      trip: trip({ total: [amd('6493.12'), { amount: '1500', currency: 'RUB' }] }),
      pending: 2,
    })
    const lines = view.findAll('.line').map(plain)
    // «1 500 ₽ · ≈ 1 347 ₽» читалось «1 500 ₽ ≈ 1 347 ₽» (адверсариальное А4).
    expect(lines[0]).toBe('1 500 ₽')
    expect(parts(view)).toEqual(['≈ 1 347 ₽', 'курс 4,82 ֏/₽', '15 янв.'])
    expect(view.get('.note').text()).toBe('+ 2 позиции ещё не ушли · пересчёт только по AMD')
  })

  it('запись ещё не ушла — прочерк и почему', () => {
    const view = card({ trip: null, local: true })
    expect(view.get('.sum').text()).toBe('—')
    expect(view.text()).toContain(ru.trip.caveat.local)
  })

  // MOL-207, Ф-23: what the prices say beside a receipt's sum is parts of the one line, no column.
  describe('сумма по чеку — частями строки (MOL-207)', () => {
    const receipt = (over: Over) =>
      card({
        trip: trip({
          converted: null,
          rate: null,
          total: over.receipt ? [over.receipt] : [],
          ...over,
        }),
      })

    it('«Итого по чеку» крупно; под ним цены, сколько с ценой и что без цены — суммы сервера', () => {
      const view = receipt({
        receipt: amd('12400'),
        prices: [amd('8300')],
        gap: { kind: 'unpriced', amount: amd('4100') },
        rows: [amd('8300'), null],
      })
      expect(view.get('.caption').text()).toBe(ru.trip.receipt.total)
      expect(plain(view.get('.sum'))).toBe('12 400 ֏')
      expect(parts(view)).toEqual(['по ценам 8 300 ֏ — 1 из 2', 'без цены — 4 100 ֏'])
      // «С ценой — n из m» of the record is not said twice beside it.
      expect(plain(view)).not.toContain('С ценой')
      expect(view.find('.split').exists()).toBe(false)
    })

    it('цены сошлись с чеком — «с чеком сходится»', () => {
      const view = receipt({ receipt: amd('5633'), prices: [amd('5633')], rows: [amd('5633')] })
      expect(parts(view)).toEqual(['по ценам 5 633 ֏', 'с чеком сходится'])
    })

    it('цены больше чека — «чек меньше цен», без слова «скидка» и без плашки (В-1 «а»)', () => {
      const view = receipt({
        receipt: amd('9870'),
        prices: [amd('10070')],
        gap: { kind: 'over', amount: amd('200') },
        rows: [amd('10070')],
      })
      expect(parts(view)).toEqual(['по ценам 10 070 ֏', 'чек меньше цен на 200 ֏'])
      expect(plain(view)).not.toContain('скидк')
      expect(view.find('.warn').exists()).toBe(false)
    })

    it('чек больше цен, все с ценой — «чек больше цен»', () => {
      const view = receipt({
        receipt: amd('8200'),
        prices: [amd('8000')],
        gap: { kind: 'under', amount: amd('200') },
        rows: [amd('8000')],
      })
      expect(parts(view)).toEqual(['по ценам 8 000 ֏', 'чек больше цен на 200 ֏'])
    })

    it('цены в другой валюте — суммы цен списком, не сложением, и ни слова о сходстве (ревью №2, А3)', () => {
      const view = receipt({
        receipt: amd('8200'),
        prices: [amd('8000'), { amount: '20', currency: 'USD' }],
        rows: [amd('8000'), { amount: '20', currency: 'USD' }],
      })
      expect(parts(view)).toEqual(['по ценам 8 000 ֏ и 20 $'])
      expect(plain(view)).not.toContain('+')
    })

    it('цены сошлись с чеком, а у позиции цены нет — «без цены — 0 ֏», не «сходится» (А4)', () => {
      const view = receipt({ receipt: amd('570'), prices: [amd('570')], rows: [amd('570'), null] })
      expect(parts(view)).toEqual(['по ценам 570 ֏ — 1 из 2', 'без цены — 0 ֏'])
    })

    // Adversarial А1: a purchase removed or added with no signal is on the screen and not in the
    // server's figures yet — the line spoke of a list no longer shown.
    it('строки на экране не те, что посчитал сервер, — о ценах ни слова, сумма чека остаётся (А1)', () => {
      const server = {
        receipt: amd('1400'),
        prices: [amd('570')],
        gap: { kind: 'unpriced' as const, amount: amd('830') },
        rows: [amd('570'), null],
      }
      const removing = card({
        trip: trip({ converted: null, rate: null, total: [amd('1400')], ...server }),
        rows: { kept: 1, unpriced: 0 },
      })
      expect(plain(removing.get('.sum'))).toBe('1 400 ֏')
      expect(parts(removing)).toEqual([])
      const adding = card({
        trip: trip({ converted: null, rate: null, total: [amd('1400')], ...server }),
        rows: { kept: 3, unpriced: 1 },
      })
      expect(parts(adding)).toEqual([])
      // Control: the same list on screen as the server's — the line is said.
      const same = card({
        trip: trip({ converted: null, rate: null, total: [amd('1400')], ...server }),
        rows: { kept: 2, unpriced: 1 },
      })
      expect(parts(same)).toEqual(['по ценам 570 ֏ — 1 из 2', 'без цены — 830 ֏'])
    })

    it('ни одной цены — так и сказано, сумма без цены не повторяет итог', () => {
      const view = receipt({
        receipt: amd('8200'),
        gap: { kind: 'unpriced', amount: amd('8200') },
        rows: [null, null],
      })
      expect(parts(view)).toEqual([ru.trip.receipt.line_none])
    })

    it('сумма без покупок — ни слова о ценах, которых нет', () => {
      expect(parts(receipt({ receipt: amd('1700') }))).toEqual([])
    })

    it('с курсом — части чека, затем «≈» и курс; ни одного числа без слова', () => {
      const view = card({
        trip: trip({
          total: [amd('9870')],
          receipt: amd('9870'),
          prices: [amd('10070')],
          gap: { kind: 'over', amount: amd('200') },
          rows: [amd('10070')],
          converted: { amount: '2328', currency: 'RUB' },
        }),
      })
      expect(parts(view)).toEqual([
        'по ценам 10 070 ֏',
        'чек меньше цен на 200 ֏',
        '≈ 2 328 ₽',
        'курс 4,82 ֏/₽',
        '15 янв.',
      ])
      for (const part of parts(view)) expect(part, part).toMatch(/[а-яё≈]/iu)
    })
  })

  it('в карточке нет «+ Сумма по чеку» — кнопка стоит под ней; сумма в очереди — строкой', () => {
    const view = card({ receiptWaiting: { receipt: { minor: 1_240_000n, currency: 'AMD' } } })
    expect(view.findAll('button')).toHaveLength(1)
    expect(view.text()).not.toContain(ru.trip.receipt.add)
    expect(plain(view.get('.sum'))).toBe('6 493,12 ֏')
    expect(view.text().replaceAll('\u00a0', ' ')).toContain('Сумма по чеку 12 400 ֏ · отправляется')
  })
})
