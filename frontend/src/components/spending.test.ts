import { describe, expect, it } from 'vitest'
import { parseMoney } from '@molvia/model'
import type { MoneyMonthView, SpendingCategoryView } from '@molvia/model'
import {
  asTyped,
  categoriesWith,
  journalOf,
  mergePages,
  rateWords,
  unsentIn,
} from '@/components/spending'
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
    rest: null,
    rate: null,
    rateKind: 'live',
    previousSpent: null,
    byCategory: [],
    categories: [beauty],
    days: [
      {
        day: '2026-09-26',
        total: amd('5000'),
        estimated: false,
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
    const days = journalOf(month(), [record(NEW, '2026-09-26')], [])
    expect(days[0]?.rows.map((row) => row.key)).toEqual([NEW, BARBER])
    expect(days[0]?.rows[0]).toMatchObject({ mark: 'waiting', counted: null, local: true })
    // The day's total stays the server's: the phone adds nothing up (Р-3).
    expect(days[0]?.total).toEqual(amd('5000'))
  })

  it('makes a day for one the server has no rows on, and gives it no total', () => {
    const days = journalOf(month(), [record(NEW, '2026-09-25')], [])
    expect(days.map((day) => day.day)).toEqual(['2026-09-26', '2026-09-25', '2026-09-24'])
    expect(days[1]?.total).toBeNull()
  })

  it('leaves out one of another month, and one of a day the pages have not reached', () => {
    expect(journalOf(month(), [record(NEW, '2026-08-31')], []).flatMap((d) => d.rows)).toHaveLength(
      3,
    )
    const cut = month({ cursor: { day: '2026-09-24', moment: 1, id: RENT }, remaining: 5 })
    const days = journalOf(cut, [record(NEW, '2026-09-20')], [])
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).not.toContain(NEW)
  })

  it('hides a row being removed and marks one being amended — its figures stay the server’s', () => {
    const days = journalOf(
      month(),
      [
        { kind: 'remove', id: BARBER },
        { kind: 'amend', id: RENT, body: { revision: 2, ...bodyOf(RENT, '2026-09-24') } },
      ],
      [],
    )
    expect(days.map((day) => day.day)).toEqual(['2026-09-24'])
    expect(days[0]?.rows[0]).toMatchObject({ mark: 'editing', counted: amd('160000') })
  })

  it('marks a refused row «Не принята», and a refused record stands where it would have', () => {
    const refusals: RejectedSpendingWrite[] = [
      {
        key: 'a',
        write: {
          kind: 'amend',
          id: RENT,
          body: { revision: 1, ...bodyOf(RENT, '2026-09-24') },
        },
        code: 'error.conflict',
      },
      { key: 'b', write: record(NEW, '2026-09-26'), code: 'error.spending_in_future' },
    ]
    const days = journalOf(month(), [], refusals)
    expect(days[0]?.rows[0]).toMatchObject({ key: NEW, mark: 'refused', local: true })
    expect(days[1]?.rows[0]).toMatchObject({ key: RENT, mark: 'refused', local: false })
  })

  it('Н2: a removal taken back by «Вернуть» behind it hides nothing and counts nothing', () => {
    const pending: SpendingWrite[] = [
      { kind: 'remove', id: BARBER },
      { kind: 'restore', id: BARBER },
    ]
    const days = journalOf(month(), pending, [])
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).toContain(BARBER)
    expect(unsentIn(month(), pending)).toBe(0)
  })

  it('hides a spending still on the phone once its removal waits', () => {
    const days = journalOf(month(), [record(NEW, '2026-09-26'), { kind: 'remove', id: NEW }], [])
    expect(days.flatMap((day) => day.rows.map((row) => row.key))).not.toContain(NEW)
  })

  it('shows one still on the phone as last typed — the amendment behind its record (Т-4)', () => {
    const days = journalOf(
      month(),
      [
        record(NEW, '2026-09-26'),
        {
          kind: 'amend',
          id: NEW,
          body: { revision: 1, ...bodyOf(NEW, '2026-09-26'), amount: amd('500') },
        },
      ],
      [],
    )
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
})
