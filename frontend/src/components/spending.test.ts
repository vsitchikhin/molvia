import { describe, expect, it } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import {
  asTyped,
  categoriesWith,
  dayTotalText,
  journalOf,
  journalRowProps,
  mergePages,
  rateWords,
  refusedRows,
  spentApprox,
  unbroken,
  unsentIn,
} from '@/components/spending'
import type { JournalRow } from '@/components/spending'
import { createAppI18n } from '@/i18n'
import type { RejectedSpendingWrite, SpendingWrite } from '@/stores/spendingQueue'

const BEAUTY = 'ffffffff-0000-4000-8000-000000000001'
const TAXI = 'ffffffff-0000-4000-8000-000000000002'
const BARBER = 'eeeeeeee-0000-4000-8000-000000000001'
const RENT = 'eeeeeeee-0000-4000-8000-000000000002'
const NEW = 'eeeeeeee-0000-4000-8000-000000000003'
const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

const amd = (text: string) => parseMoney(text, 'AMD')
/** Intl puts no-break spaces between the digits and before the sign. */
const plain = (text: string) => text.replace(/\s/g, ' ')

const beauty: SpendingCategoryView = {
  id: BEAUTY,
  preset: 'beauty',
  name: null,
  colour: null,
  archived: false,
}

function spending(id: string, spentOn: string, price: string, note: string | null = null) {
  return {
    id,
    spentOn,
    amount: amd(price),
    categoryId: BEAUTY,
    note,
    place: null,
    rate: null,
    accountId: null,
    debited: null,
    transferId: null,
    revision: 2,
    amendedAt: null,
  }
}

function month(patch: Partial<MoneyMonthView> = {}): MoneyMonthView {
  return {
    month: '2026-09',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    spent: amd('165000'),
    uncounted: [],
    foreign: [],
    spentIncome: null,
    income: parseMoney('0', 'RUB'),
    incomeUncounted: [],
    count: 0,
    incomeCount: 0,
    shiftedIn: [],
    shiftedOut: [],
    rest: null,
    accountsFrom: null,
    accountsRemoved: false,
    budget: null,
    rate: null,
    rateKind: 'live',
    previousSpent: null,
    previousToDay: null,
    byCategory: [],
    slices: [],
    categories: [beauty],
    days: [
      {
        day: '2026-09-26',
        total: amd('5000'),
        estimated: false,
        uncounted: [],
        entries: [
          {
            kind: 'manual',
            spending: spending(BARBER, '2026-09-26', '5000', 'Барбер'),
            counted: amd('5000'),
          },
        ],
      },
      {
        day: '2026-09-24',
        total: amd('168940'),
        estimated: false,
        uncounted: [],
        entries: [
          {
            kind: 'manual',
            spending: spending(RENT, '2026-09-24', '160000'),
            counted: amd('160000'),
          },
          {
            kind: 'trip',
            tripId: TRIP,
            placeName: 'Ереван Сити',
            items: 7,
            finishedOn: '2026-09-24',
            amount: amd('8940'),
            counted: amd('8940'),
          },
        ],
      },
    ],
    cursor: null,
    remaining: 0,
    remainingFrom: null,
    remainingTo: null,
    ...patch,
  }
}

const bodyOf = (id: string, spentOn: string) => ({
  id,
  spentOn,
  amount: amd('1500'),
  categoryId: BEAUTY,
})
const record = (id: string, spentOn: string): SpendingWrite => ({
  kind: 'record',
  body: bodyOf(id, spentOn),
})

describe('the journal with the queue laid over it', () => {
  it('puts a spending still on the phone at the top of its day, with no figure of its own', () => {
    const days = journalOf(month(), [record(NEW, '2026-09-26')])
    expect(days[0]?.rows.map((row) => row.key)).toEqual([NEW, BARBER])
    expect(days[0]?.rows[0]).toMatchObject({ mark: 'waiting', counted: null, local: true })
    // The day's total stays the server's: the phone adds nothing up (Р-3).
    expect(days[0]?.total).toEqual(amd('5000'))
  })

  it('makes a day for one the server has no rows on, and gives it no total', () => {
    const days = journalOf(month(), [record(NEW, '2026-09-25')])
    expect(days.map((day) => day.day)).toEqual(['2026-09-26', '2026-09-25', '2026-09-24'])
    expect(days[1]?.total).toBeNull()
  })

  it('leaves out one of another month, and one of a day the pages have not reached', () => {
    expect(journalOf(month(), [record(NEW, '2026-08-31')]).flatMap((d) => d.rows)).toHaveLength(3)
    const cut = month({ cursor: { day: '2026-09-24', moment: 1, id: RENT }, remaining: 5 })
    const days = journalOf(cut, [record(NEW, '2026-09-20')])
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).not.toContain(NEW)
  })

  it('hides a row being removed and marks one being amended — its figures stay the server’s', () => {
    const days = journalOf(month(), [
      { kind: 'remove', id: BARBER },
      { kind: 'amend', id: RENT, body: { revision: 2, ...bodyOf(RENT, '2026-09-24') } },
    ])
    expect(days.map((day) => day.day)).toEqual(['2026-09-24'])
    expect(days[0]?.rows[0]).toMatchObject({ mark: 'editing', counted: amd('160000') })
  })

  it('a refusal is not the journal’s: the row stays the server’s, and no refused record is drawn', () => {
    const days = journalOf(month(), [])
    expect(
      days.flatMap((day) => day.rows).every((row) => row.kind === 'trip' || row.mark === null),
    ).toBe(true)
  })

  it('Н2: a removal taken back by «Вернуть» behind it hides nothing and counts nothing', () => {
    const pending: SpendingWrite[] = [
      { kind: 'remove', id: BARBER },
      { kind: 'restore', id: BARBER },
    ]
    const days = journalOf(month(), pending)
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).toContain(BARBER)
    expect(unsentIn(month(), pending)).toBe(0)
  })

  // Out of the queue on its answer, a removal hid nothing, and the month read before it brought the
  // row back for a moment (MOL-151, adversarial А3).
  it('hides a spending whose removal landed after the month was read', () => {
    const shown = journalOf(month(), [])
    const id = shown.flatMap((day) => day.rows)[0]?.key ?? ''
    const days = journalOf(month(), [], new Set(), new Set([id]))
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).not.toContain(id)
  })

  it('hides a spending still on the phone once its removal waits', () => {
    const days = journalOf(month(), [record(NEW, '2026-09-26'), { kind: 'remove', id: NEW }])
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).not.toContain(NEW)
  })

  it('hides the line of a trip whose removal waits, and leaves the day total the server’s (MOL-76)', () => {
    const shown = journalOf(month(), [])
    const trip = shown.flatMap((day) => day.rows).find((row) => row.kind === 'trip')
    expect(trip).toBeDefined()
    const hidden = journalOf(month(), [], new Set([TRIP]))
    expect(hidden.flatMap((day) => day.rows).some((row) => row.kind === 'trip')).toBe(false)
    expect(hidden.map((day) => day.total)).toEqual(shown.map((day) => day.total))
  })

  it('shows one still on the phone as last typed — the amendment behind its record (Т-4)', () => {
    const days = journalOf(month(), [
      record(NEW, '2026-09-26'),
      {
        kind: 'amend',
        id: NEW,
        body: { revision: 1, ...bodyOf(NEW, '2026-09-26'), amount: amd('500') },
      },
    ])
    const row = days[0]?.rows[0]
    expect(row?.kind === 'manual' && row.spending.amount).toEqual(amd('500'))
  })

  it('Л: a record the month already shows is not «not counted yet»', () => {
    expect(unsentIn(month(), [record(BARBER, '2026-09-26')])).toBe(0)
    expect(unsentIn(month(), [record(NEW, '2026-09-26'), { kind: 'remove', id: NEW }])).toBe(0)
  })

  it('counts what waits in the month — records, amendments and removals of its rows', () => {
    const pending: SpendingWrite[] = [
      record(NEW, '2026-09-25'),
      record('eeeeeeee-0000-4000-8000-000000000009', '2026-08-02'),
      { kind: 'remove', id: BARBER },
      { kind: 'remove', id: 'eeeeeeee-0000-4000-8000-00000000000a' },
    ]
    expect(unsentIn(month(), pending)).toBe(2)
  })
})

describe('the journal read a page at a time', () => {
  it('continues a day cut by the page rather than starting it again', () => {
    const [newest, older] = month().days
    if (!newest || !older) throw new Error('two days')
    const first = month({
      days: [newest],
      cursor: { day: '2026-09-26', moment: 1, id: BARBER },
      remaining: 2,
    })
    const next = month({ days: [older], cursor: null, remaining: 0 })
    const merged = mergePages(first, next)
    expect(merged.days.map((day) => day.day)).toEqual(['2026-09-26', '2026-09-24'])
    expect(merged.cursor).toBeNull()

    const sameDay = month({ days: [{ ...newest, entries: [] }] })
    expect(mergePages(first, sameDay).days[0]?.entries).toHaveLength(1)
  })
})

describe('the categories as the phone knows them', () => {
  it('adds one made with no signal after the others, and applies a removal not yet sent', () => {
    const list = categoriesWith(
      [beauty],
      [
        { kind: 'category-add', body: { id: TAXI, name: 'Такси' } },
        { kind: 'category-archive', id: BEAUTY },
      ],
    )
    expect(list.map((one) => [one.id, one.archived])).toEqual([
      [BEAUTY, true],
      [TAXI, false],
    ])
    expect(list[1]).toMatchObject({ preset: null, name: 'Такси', colour: 0 })
  })
})

describe('what the screen prints', () => {
  it('an amount as it was typed — no «,00», never a fraction rounded away', () => {
    expect(plain(asTyped(amd('5000'), 'ru-RU'))).toBe('5 000 ֏')
    expect(plain(asTyped(parseMoney('2495.69', 'RUB'), 'ru-RU'))).toBe('2 495,69 ₽')
  })

  it('a rate in words on its side of one', () => {
    const t = (key: string, named: Record<string, unknown>) =>
      `${key}:${String(named.amount)}|${String(named.sign)}`
    const rate = {
      base: 'RUB',
      quote: 'AMD',
      scaled: 4_620_000n,
      source: 'personal',
      asOf: new Date(),
    } as const
    expect(plain(rateWords(rate, 'ru-RU', t))).toBe('spending.rate_value:4,62 ֏|₽')
  })

  it('a day’s sum names what had no rate beside what was counted, never «≈ 0 ֏» (MOL-184, В-1)', () => {
    const usd = (text: string) => parseMoney(text, 'USD')
    const day = (total: string, estimated: boolean, uncounted = [] as ReturnType<typeof usd>[]) =>
      plain(dayTotalText({ total: amd(total), estimated, uncounted }, 'ru-RU') ?? '')
    expect(day('5000', false)).toBe('5 000 ֏')
    expect(day('4400', true)).toBe('≈ 4 400 ֏')
    expect(day('5000', false, [usd('50')])).toBe('5 000 ֏ + 50 $')
    expect(day('4400', true, [parseMoney('10', 'EUR'), usd('50')])).toBe('≈ 4 400 ֏ + 10 € + 50 $')
    expect(day('0', false, [usd('50')])).toBe('50 $')
    // What had no rate is as written, never rounded: no «6 €» over «5,50 €», no «0 $» (adversarial А2).
    expect(day('5000', false, [parseMoney('5.50', 'EUR')])).toBe('5 000 ֏ + 5,50 €')
    expect(day('0', false, [usd('0.40')])).toBe('0,40 $')
    // «Must not fire»: a day of nothing but drams is its sum, and a day only the phone knows has none.
    expect(day('0', false)).toBe('0 ֏')
    expect(dayTotalText({ total: null, estimated: false, uncounted: [] }, 'ru-RU')).toBeNull()
  })

  it('«≈» of the month only in another currency and over something counted (MOL-184, А3, А4)', () => {
    const rub = parseMoney('68788', 'RUB')
    expect(spentApprox(month({ spent: amd('317800'), spentIncome: rub }))).toEqual(rub)
    // One who earns and spends in drams: no «≈ 5 000 ֏» under exact drams.
    expect(spentApprox(month({ spent: amd('5000'), spentIncome: amd('5000') }))).toBeNull()
    // Nothing counted — $50 with no rate: no «≈ 0 ₽» over it.
    const nothing = month({ spent: amd('0'), spentIncome: parseMoney('0', 'RUB') })
    expect(spentApprox(nothing)).toBeNull()
    expect(spentApprox(month({ spentIncome: null }))).toBeNull()
  })
})

/**
 * «Не приняты» (MOL-159): every refused typing is a row of its own, whatever the month shown and its
 * pages — five rounds of review found a refusal left on a card whose one action threw it away, each
 * time at another edge of a guess where its row was. These are those edges, all at once.
 */
describe('refused spendings, apart from the journal', () => {
  const refusal = (write: SpendingWrite, code = 'error.spending_category_unknown') =>
    ({ key: `k-${write.kind}`, write, code }) as RejectedSpendingWrite
  const amendment = (id: string, spentOn: string, revision = 1): SpendingWrite => ({
    kind: 'amend',
    id,
    body: { revision, ...bodyOf(id, spentOn), amount: amd('6000') },
  })

  it('a refused record is a row whatever the month: this one, another, a day no page reached, none answered', () => {
    const cut = month({ cursor: { day: '2026-09-24', moment: 1, id: RENT }, remaining: 5 })
    for (const [shown, day] of [
      [month(), '2026-09-26'],
      [month(), '2026-08-31'],
      [cut, '2026-09-01'],
      [null, '2026-09-26'],
    ] as const) {
      const rows = refusedRows(shown, [refusal(record(NEW, day))], [])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ key: NEW, mark: 'refused', local: true })
      expect(rows[0]?.spending.spentOn).toBe(day)
    }
  })

  it('a refused amendment of a row the month holds: what was typed, over the server’s revision', () => {
    const [row] = refusedRows(month(), [refusal(amendment(RENT, '2026-09-24'))], [])
    expect(row).toMatchObject({ key: RENT, mark: 'refused', local: false })
    expect(row?.spending.amount).toEqual(amd('6000'))
    expect(row?.spending.revision).toBe(2)
  })

  it('one of a row not loaded, moved across the month’s edge, or removed elsewhere: still a row, over its own revision', () => {
    for (const day of ['2026-09-01', '2026-10-01']) {
      const [row] = refusedRows(month(), [refusal(amendment(NEW, day, 4), 'error.not_found')], [])
      expect(row).toMatchObject({ key: NEW, mark: 'refused', local: false })
      expect(row?.spending).toMatchObject({ spentOn: day, revision: 4 })
    }
  })

  it('must not fire: a refusal that is not a spending’s typing — a category, a removal — is no row', () => {
    expect(
      refusedRows(
        month(),
        [refusal({ kind: 'remove', id: BARBER }), refusal({ kind: 'restore', id: BARBER })],
        [],
      ),
    ).toEqual([])
  })
})

/** A line of «Траты» as its row says it (MOL-176): what the journal's own row drew by itself, read here. */
describe('a line of the journal as its row says it', () => {
  const { t } = createAppI18n('ru').global
  const groceries: SpendingCategoryView = {
    id: 'ffffffff-0000-4000-8000-000000000009',
    preset: 'groceries',
    name: null,
    colour: null,
    archived: false,
  }

  function manual(patch: Partial<Extract<JournalRow, { kind: 'manual' }>> = {}): JournalRow {
    return {
      kind: 'manual',
      key: TAXI,
      spending: { ...spending(TAXI, '2026-09-27', '1800'), place: 'Кофеман' },
      counted: null,
      mark: null,
      refusal: null,
      local: false,
      ...patch,
    }
  }
  const trip: JournalRow = {
    kind: 'trip',
    key: TRIP,
    tripId: TRIP,
    placeName: 'Ереван Сити',
    items: 9,
    amount: amd('11280'),
    counted: null,
  }
  function row(value: JournalRow, category: SpendingCategoryView | null = beauty, when = '') {
    return journalRowProps(value, {
      t,
      locale: 'ru-RU',
      category,
      categoryName: category?.preset === 'groceries' ? 'Продукты' : 'Красота',
      spendCurrency: 'AMD',
      when,
    })
  }
  const euro = (patch: Partial<Extract<JournalRow, { kind: 'manual' }>> = {}) =>
    manual({
      spending: { ...spending(TAXI, '2026-09-27', '1'), amount: parseMoney('24.99', 'EUR') },
      ...patch,
    })

  it('a spending: the amount as typed, with no sign, and nothing under it in the spending currency', () => {
    const value = row(manual())
    expect(plain(value.amount ?? '')).toBe('1 800 ֏')
    expect(value.sub).toBeNull()
  })

  it('in another currency: «≈» of what the server counted it as, or that it could not', () => {
    expect(plain(row(euro({ counted: amd('10560.40') })).sub ?? '')).toBe('≈ 10 560 ֏')
    expect(row(euro()).sub).toBe('не\u00a0посчитано')
  })

  it('must not fire: a row only the phone holds says no «не посчитано» — «Отправляем…» says it', () => {
    expect(row(euro({ local: true, mark: 'waiting' })).sub).toBeNull()
  })

  it('without a note is titled by its category, the place under it; with one, the category and the place', () => {
    expect([row(manual()).title, row(manual()).meta]).toEqual(['Красота', 'Кофеман'])
    const noted = row(
      manual({ spending: { ...spending(TAXI, '2026-09-27', '1800', 'Стрижка'), place: 'Барбер' } }),
    )
    expect([noted.title, noted.meta]).toEqual(['Стрижка', 'Красота · Барбер'])
  })

  it('a transfer’s fee says what it is: «Прочее · комиссия за перевод» (MOL-253, Р-1)', () => {
    const fee = manual({
      spending: {
        ...spending(TAXI, '2026-09-27', '20'),
        place: null,
        transferId: 'eeeeeeee-0000-4000-8000-000000000001',
      },
    })
    expect(row(fee).title).toBe('Прочее · комиссия за перевод')
  })

  it('puts the day first where rows of different days stand together', () => {
    expect(row(manual(), beauty, 'Вчера').meta).toBe('Вчера · Кофеман')
  })

  it('a spending stands in its category’s circle; one the phone does not know, in no colour', () => {
    expect(row(manual()).tint).toBe('var(--cat-beauty)')
    expect(row(manual(), null).tint).toBe('muted')
  })

  it('a trip: its shop, its purchases counted, the circle of «Продукты» — never the accent (Ф-4)', () => {
    const value = row(trip, groceries)
    expect([value.title, value.meta, value.tint, value.verb]).toEqual([
      'Покупки в «Ереван Сити»',
      'Продукты · 9 позиций',
      'var(--cat-groceries)',
      'Открыть покупки:',
    ])
    expect(row(trip, null).tint).toBe('var(--cat-groceries)')
  })

  it('a trip with money and no purchase is the receipt’s sum, never «0 позиций» (MOL-227)', () => {
    expect(row({ ...trip, items: 0 }, groceries).meta).toBe('Продукты · сумма по чеку')
  })

  it('marks what the queue says as a tag: on its way and amended wait, a refusal is bad', () => {
    expect(row(manual({ mark: 'waiting' })).tag).toEqual({ tone: 'warn', text: 'Отправляем…' })
    expect(row(manual({ mark: 'editing' })).tag).toEqual({
      tone: 'warn',
      text: 'Правка отправляется',
    })
    expect(row(manual({ mark: 'refused' })).tag).toEqual({ tone: 'bad', text: 'Не принята' })
    expect(row(manual()).tag).toBeNull()
    expect(row(manual()).verb).toBe('Открыть трату:')
  })
})

describe('a line under an amount breaks only between its parts (MOL-176, adversarial round 2, Б3)', () => {
  it('glues the words of its last part, never the figures before it', () => {
    expect(unbroken('25\u00a0000\u00a0₽ · без «списано»')).toBe(
      '25\u00a0000\u00a0₽ · без\u00a0«списано»',
    )
    expect(unbroken('25,000 ₽ · no “charged”')).toBe('25,000 ₽ · no\u00a0“charged”')
  })

  it('leaves a break between two amounts and after «·»', () => {
    expect(unbroken('2\u00a0331,85\u00a0₽, 24,99\u00a0€ · без «списано»')).toBe(
      '2\u00a0331,85\u00a0₽, 24,99\u00a0€ · без\u00a0«списано»',
    )
  })

  it('a line of one part is glued whole', () => {
    expect(unbroken('не посчитано')).toBe('не\u00a0посчитано')
  })
})
