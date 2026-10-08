import { describe, expect, it } from 'vitest'
import { parseMoney } from '@molvia/model'
import type {
  AccountOperationView,
  Currency,
  MoneyAccountView,
  SpendingCategoryView,
} from '@molvia/model'
import {
  canTransfer,
  defaultAccount,
  operationRowProps,
  pageOrder,
  pickerGroups,
  removedOf,
} from '@/components/accounts'
import { createAppI18n } from '@/i18n'

let next = 0
function account(
  name: string,
  currency: Currency,
  patch: Partial<MoneyAccountView> = {},
): MoneyAccountView {
  next += 1
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    name,
    currency,
    savings: false,
    start: parseMoney('0', currency),
    startOn: '2026-09-16',
    balance: parseMoney('0', currency),
    approximate: false,
    uncounted: 0,
    inSpend: null,
    rate: null,
    lastCheckedOn: null,
    hasOperations: false,
    archivedAt: null,
    revision: 1,
    ...patch,
  }
}

const dollarsHome = account('Доллары дома', 'USD', { savings: true })
const cashAmd = account('Наличные ֏', 'AMD')
const cardRub = account('Карта ₽', 'RUB')
const oldCard = account('Вторая карта ₽', 'RUB', { archivedAt: new Date('2026-09-21') })
const cashRub = account('Наличные ₽', 'RUB')
const all = [dollarsHome, cashAmd, cardRub, oldCard, cashRub]

describe('accounts in the order of the page', () => {
  it('puts spending before savings, keeps the order they were added, leaves the removed out', () => {
    expect(pageOrder(all).map(({ name }) => name)).toEqual([
      'Наличные ֏',
      'Карта ₽',
      'Наличные ₽',
      'Доллары дома',
    ])
    expect(removedOf(all)).toEqual([oldCard])
  })

  it('starts an operation on the first live account of its currency, or none', () => {
    expect(defaultAccount(all, 'RUB')).toBe(cardRub)
    expect(defaultAccount(all, 'USD')).toBe(dollarsHome)
    expect(defaultAccount(all, 'EUR')).toBeNull()
    // A removed account is never offered, even when it is the only one of its currency.
    expect(defaultAccount([oldCard], 'RUB')).toBeNull()
    expect(defaultAccount([], 'AMD')).toBeNull()
  })

  it('offers the other currencies to a spending and a trip only', () => {
    expect(pickerGroups(all, 'AMD', false)).toEqual({
      own: [cashAmd],
      other: [cardRub, cashRub, dollarsHome],
    })
    expect(pickerGroups(all, 'RUB', true)).toEqual({ own: [cardRub, cashRub], other: [] })
    expect(pickerGroups(all, 'EUR', true)).toEqual({ own: [], other: [] })
  })
})

/**
 * A row of an account's journal, «не попали» and a check (MOL-176): the words the component drew by
 * itself until the kit took the row, every rule of them read here.
 */
describe('where a transfer can be made (MOL-253)', () => {
  it('needs two live accounts of one currency — of the one named, or of any', () => {
    expect(canTransfer(all, 'RUB')).toBe(true)
    expect(canTransfer(all, 'AMD')).toBe(false)
    expect(canTransfer(all)).toBe(true)
  })

  it('must not fire: a removed account is not the second one', () => {
    expect(canTransfer([cardRub, oldCard], 'RUB')).toBe(false)
    expect(canTransfer([cardRub, oldCard, cashAmd, dollarsHome])).toBe(false)
  })
})

describe('an operation as its row says it', () => {
  const OTHER = 'aaaaaaaa-0000-4000-8000-000000000001'
  const CAFE = 'aaaaaaaa-0000-4000-8000-000000000002'
  const GROCERIES = 'aaaaaaaa-0000-4000-8000-000000000003'
  const CARD = 'cccccccc-0000-4000-8000-000000000001'
  const CASH = 'cccccccc-0000-4000-8000-000000000002'
  const categories: SpendingCategoryView[] = [
    { id: OTHER, preset: 'other', name: null, colour: null, archived: false },
    { id: CAFE, preset: 'cafe', name: null, colour: null, archived: false },
    { id: GROCERIES, preset: 'groceries', name: null, colour: null, archived: false },
  ]
  const NAMES: Record<string, string> = { cafe: 'Кафе', groceries: 'Продукты', other: 'Прочее' }
  const { t } = createAppI18n('ru').global
  const plain = (text: string | null) => (text ?? '').replace(/\s/g, ' ')
  const money = (text: string, currency: Currency = 'AMD') => {
    const negative = text.startsWith('-')
    const value = parseMoney(negative ? text.slice(1) : text, currency)
    return negative ? { ...value, minor: -value.minor } : value
  }

  function operation(patch: Partial<AccountOperationView> = {}): AccountOperationView {
    return {
      kind: 'spending',
      id: 'dddddddd-0000-4000-8000-000000000001',
      side: null,
      day: '2026-09-27',
      at: new Date('2026-09-27T09:00:00Z'),
      accountId: CASH,
      amounts: [money('-1800')],
      moved: money('-1800'),
      approximate: false,
      debited: null,
      inBalance: true,
      unpriced: 0,
      revision: 1,
      items: null,
      categoryId: CAFE,
      note: null,
      place: null,
      source: null,
      counterpart: null,
      transferId: null,
      ...patch,
    }
  }
  function row(value: AccountOperationView, inAccount = true) {
    return operationRowProps(value, {
      t,
      locale: 'ru-RU',
      categories,
      nameOf: (category) => NAMES[category.preset ?? 'other'] ?? '',
      accountName: (id) => (id === CARD ? 'Карта' : null),
      inAccount,
    })
  }

  describe('the amount in an account', () => {
    it('is what it moved there, with its sign — «−» for out, «+» for in', () => {
      expect(plain(row(operation()).amount)).toBe('\u22121 800 ֏')
      expect(
        plain(
          row(operation({ kind: 'income', amounts: [money('5000')], moved: money('5000') })).amount,
        ),
      ).toBe('+5 000 ֏')
    })

    it('says «≈» and whole units when a rate of its day counted it', () => {
      const counted = operation({
        amounts: [money('-24.99', 'EUR')],
        moved: money('-10560.40'),
        approximate: true,
      })
      expect(plain(row(counted).amount)).toBe('≈ \u221210 560 ֏')
    })

    it('says «не посчитано» when no rate counts it', () => {
      expect(row(operation({ amounts: [money('-24.99', 'EUR')], moved: null })).amount).toBe(
        'не посчитано',
      )
    })

    it('puts the operation’s own money of another currency under it, with «списано» or without', () => {
      const other = { amounts: [money('-2331.85', 'RUB')], moved: money('-9891') }
      expect(plain(row(operation({ ...other, debited: money('9891') })).sub)).toBe(
        '2 331,85 ₽ · списано',
      )
      expect(plain(row(operation(other)).sub)).toBe('2 331,85 ₽ · без «списано»')
      // Broken only after «·»: never «без» over ««списано»» (adversarial round 2, Б3).
      expect(row(operation(other)).sub).toContain(' · без\u00a0«списано»')
    })

    it('must not fire: no line under it in the account’s own currency, or with nothing counted', () => {
      expect(row(operation()).sub).toBeNull()
      expect(row(operation({ amounts: [money('-24.99', 'EUR')], moved: null })).sub).toBeNull()
    })
  })

  it('out of any account, is the operation’s own amount with its sign, and nothing under it', () => {
    const value = operation({ accountId: null, moved: null, amounts: [money('-1200')] })
    expect(plain(row(value, false).amount)).toBe('\u22121 200 ֏')
    expect(row(value, false).sub).toBeNull()
    expect(row(operation({ kind: 'trip', amounts: [], moved: null }), false).amount).toBeNull()
  })

  it('never carries a colour: there is no field for one — «плохо» is the balance’s alone', () => {
    expect(Object.keys(row(operation({ moved: money('-999999') }))).sort()).toEqual(
      ['amount', 'icon', 'meta', 'sub', 'tag', 'tint', 'title', 'verb'].sort(),
    )
  })

  describe('a spending', () => {
    it('without a note is titled by its category, the place under it', () => {
      const value = row(operation({ place: 'Кофеман' }))
      expect([value.title, value.meta]).toEqual(['Кафе', 'Кофеман'])
    })

    it('with a note is titled by it, the category and the place under it', () => {
      expect(row(operation({ note: 'Кофе с собой', place: 'Кофеман' })).meta).toBe('Кафе · Кофеман')
      expect(row(operation({ note: 'Кофе с собой' })).meta).toBe('Кафе')
    })

    it('stands in its category’s circle; one the phone does not know, in no colour', () => {
      expect(row(operation()).tint).toBe('var(--cat-cafe)')
      expect(row(operation({ categoryId: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).tint).toBe(
        'muted',
      )
      expect(row(operation({ categoryId: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).title).toBe(
        'Прочее',
      )
    })
  })

  describe('«Прочее · сверка» — what «Записать разницу» wrote', () => {
    it('is told by its note in either language, under «Прочее»', () => {
      for (const note of ['сверка', 'check']) {
        const value = row(operation({ categoryId: OTHER, note }))
        expect([value.title, value.meta]).toEqual(['Прочее · сверка', 'расход по сверке'])
      }
    })

    it('is an income of «другое» too', () => {
      const value = row(
        operation({ kind: 'income', source: 'other', note: 'check', categoryId: null }),
      )
      expect([value.title, value.meta]).toEqual(['Прочее · сверка', 'доход по сверке'])
    })

    it('must not fire: the same word under another category, or an income from a salary', () => {
      expect(row(operation({ note: 'сверка' })).title).toBe('сверка')
      expect(
        row(operation({ kind: 'income', source: 'salary', note: 'сверка', categoryId: null }))
          .title,
      ).toBe('Зарплата')
    })
  })

  it('an income: its source, «Доход» and its note under it, no colour', () => {
    const value = row(
      operation({ kind: 'income', source: 'salary', note: 'за сентябрь', categoryId: null }),
    )
    expect([value.title, value.meta, value.tint]).toEqual([
      'Зарплата',
      'Доход · за сентябрь',
      'muted',
    ])
  })

  describe('an exchange', () => {
    const half = (side: 'given' | 'received', accountId: string | null) =>
      operation({
        kind: 'exchange',
        side,
        categoryId: null,
        counterpart: {
          accountId,
          amount: money(side === 'given' ? '156000' : '-20000', side === 'given' ? 'AMD' : 'RUB'),
        },
      })

    it('names the other half by its account, the way the money went', () => {
      expect(plain(row(half('given', CARD)).meta)).toBe('на «Карта»: 156 000 ֏')
      expect(plain(row(half('received', CARD)).meta)).toBe('из «Карта»: 20 000 ₽')
    })

    it('with no account the phone knows, says the other half’s money alone', () => {
      expect(plain(row(half('given', null)).meta)).toBe('156 000 ֏')
      expect(plain(row(half('given', CASH)).meta)).toBe('156 000 ֏')
    })

    it('is titled «Обмен» in no colour', () => {
      expect([row(half('given', CARD)).title, row(half('given', CARD)).tint]).toEqual([
        'Обмен',
        'muted',
      ])
    })
  })

  describe('a transfer (MOL-253, handoff 03)', () => {
    const half = (side: 'given' | 'received') =>
      operation({
        kind: 'transfer',
        side,
        categoryId: null,
        amounts: [money(side === 'given' ? '-2000' : '2000', 'USD')],
        moved: money(side === 'given' ? '-2000' : '2000', 'USD'),
        counterpart: { accountId: CARD, amount: money(side === 'given' ? '2000' : '-2000', 'USD') },
      })

    it('names the other account with an arrow the way the money went, «Перевод» under it', () => {
      expect([row(half('given')).title, row(half('given')).meta]).toEqual(['→ Карта', 'Перевод'])
      expect([row(half('received')).title, row(half('received')).meta]).toEqual([
        '← Карта',
        'Перевод',
      ])
    })

    it('carries its sign and no colour — it is not a spending (Ф-4)', () => {
      expect(plain(row(half('given')).amount ?? '')).toBe('−2 000 $')
      expect(plain(row(half('received')).amount ?? '')).toBe('+2 000 $')
      expect(row(half('given')).tint).toBe('muted')
    })

    it('says its note beside «Перевод»', () => {
      expect(row(operation({ ...half('given'), note: 'на вклад' })).meta).toBe('Перевод · на вклад')
    })

    it('its fee is «Комиссия за перевод» in «Прочее», saying where the transfer went', () => {
      const fee = operation({
        categoryId: OTHER,
        amounts: [money('-20', 'USD')],
        moved: money('-20', 'USD'),
        transferId: 'eeeeeeee-0000-4000-8000-000000000001',
        counterpart: { accountId: CARD, amount: money('2000', 'USD') },
      })
      expect([row(fee).title, row(fee).meta]).toEqual(['Комиссия за перевод', 'Прочее · → Карта'])
    })
  })

  describe('a trip', () => {
    const trip = (patch: Partial<AccountOperationView> = {}) =>
      operation({
        kind: 'trip',
        place: 'SAS',
        items: 5,
        categoryId: null,
        revision: null,
        ...patch,
      })

    it('is titled by its shop, the purchases counted under it, and those without a price', () => {
      expect(row(trip()).title).toBe('Покупки в «SAS»')
      expect(row(trip()).meta).toBe('Продукты · 5 позиций')
      expect(row(trip({ unpriced: 2 })).meta).toBe('Продукты · 5 позиций, 2 без цены')
    })

    it('with no purchase is the receipt’s sum, never «0 позиций» (MOL-227)', () => {
      expect(row(trip({ items: 0 })).meta).toBe('Продукты · сумма по чеку')
    })

    it('stands in the circle of «Продукты», never the accent (Ф-4)', () => {
      expect(row(trip()).tint).toBe('var(--cat-groceries)')
      expect(
        operationRowProps(trip(), {
          t,
          locale: 'ru-RU',
          categories: [],
          nameOf: () => '',
          accountName: () => null,
          inAccount: true,
        }).tint,
      ).toBe('var(--cat-groceries)')
    })
  })

  it('every row is opened by one verb, read first', () => {
    expect(row(operation()).verb).toBe('Открыть операцию:')
    expect(row(operation()).tag).toBeNull()
  })
})
