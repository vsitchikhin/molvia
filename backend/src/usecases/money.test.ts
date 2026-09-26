import { describe, expect, it } from 'vitest'
import {
  DomainError,
  ERROR,
  SPENDING_PRESETS,
  money,
  parseRate,
  yerevanMidnight,
} from '@molvia/model'
import type {
  CachedRate,
  Currency,
  Exchange,
  ExchangeRate,
  Income,
  RatePreference,
  Spending,
  SpendingAmendBody,
  SpendingCategory,
} from '@molvia/model'
import { moneyMonthOf } from './money-month'
import { dayRates } from './money-rates'
import { amendSpending, recordSpending, removeSpending } from './spendings'
import type { TripRepositories } from '@/db/unit-of-work'

/**
 * The use cases of «Деньги» (MOL-73, review Р-8) on fake repositories: which rate is asked for, and
 * which is not. Any method a case does not hand in throws, so reaching for one is a failure to see.
 */
function fake<T extends object>(name: string, methods: Partial<T>): T {
  return new Proxy(methods, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target]
      if (key === 'then') return undefined
      return () => {
        throw new Error(`unexpected ${name}.${String(key)}`)
      }
    },
  }) as T
}

const OWNER = '3f2b1c6e-9a4d-4c1b-8f7e-2d5a6b8c9e01'
const owner = { id: OWNER, incomeCurrency: 'RUB', spendCurrency: 'AMD' } as const
const NOW = new Date('2026-09-26T10:00:00Z')

let sequence = 0
const nextId = () => {
  sequence += 1
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
}

/** Major units: `'89011.50 RUB'`. */
function cash(text: string) {
  const [amount = '', currency = ''] = text.split(' ')
  const [whole = '', cents = ''] = amount.split('.')
  return money(BigInt(whole) * 100n + BigInt(cents.padEnd(2, '0')), currency as Currency)
}

function exchange(given: string, received: string, on: string): Exchange {
  return {
    id: nextId(),
    actorId: OWNER,
    given: cash(given),
    received: cash(received),
    exchangedOn: on,
    heldBefore: null,
    note: null,
    revision: 1,
    createdAt: new Date(`${on}T12:00:00Z`),
    amendedAt: null,
  }
}

function income(amount: string, on: string): Income {
  return {
    id: nextId(),
    actorId: OWNER,
    amount: cash(amount),
    receivedOn: on,
    heldBefore: null,
    source: 'freelance',
    note: null,
    revision: 1,
    createdAt: new Date(`${on}T09:00:00Z`),
    amendedAt: null,
  }
}

const official = (currency: 'RUB' | 'USD' | 'EUR', value: string, date: string): CachedRate => ({
  provider: 'cba',
  currency,
  date,
  scaled: parseRate(value),
  jump: false,
})

const categories: SpendingCategory[] = SPENDING_PRESETS.map((preset, index) => ({
  id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
  actorId: OWNER,
  preset,
  name: null,
  colour: null,
  archivedAt: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
}))
const OTHER_CATEGORY = categories.at(-1)?.id ?? ''

function spending(amount: string, on: string, rate: ExchangeRate | null = null): Spending {
  return {
    id: nextId(),
    actorId: OWNER,
    spentOn: on,
    amount: cash(amount),
    categoryId: OTHER_CATEGORY,
    note: null,
    place: null,
    rate,
    revision: 1,
    createdAt: new Date(`${on}T10:00:00Z`),
    amendedAt: null,
  }
}

interface World {
  readonly preference?: RatePreference
  readonly exchanges?: readonly Exchange[]
  readonly incomes?: readonly Income[]
  readonly cache?: readonly CachedRate[]
  readonly spendings?: readonly Spending[]
  readonly frozen?: ExchangeRate | null
}

/** The repositories «Деньги» reads, over a small world; `asked` records what reached the cache. */
function repositoriesOf(world: World) {
  const asked: string[] = []
  const frozen: ExchangeRate[] = []
  const written: { rate: ExchangeRate | null }[] = []
  const repositories = {
    exchanges: fake<TripRepositories['exchanges']>('exchanges', {
      rateSettings: () =>
        Promise.resolve({ preference: world.preference ?? 'personal', since: null }),
      list: () => Promise.resolve([...(world.exchanges ?? [])]),
    }),
    incomes: fake<TripRepositories['incomes']>('incomes', {
      list: () => Promise.resolve([...(world.incomes ?? [])]),
    }),
    rates: fake<TripRepositories['rates']>('rates', {
      latestOnOrBefore: (currencies, day) => {
        asked.push(day)
        const rows = (world.cache ?? [])
          .filter((row) => currencies.includes(row.currency) && row.date <= day)
          .sort((a, b) => (a.date < b.date ? 1 : -1))
        return Promise.resolve(
          currencies.flatMap((currency) => rows.find((row) => row.currency === currency) ?? []),
        )
      },
    }),
    spendingCategories: fake<TripRepositories['spendingCategories']>('spendingCategories', {
      list: () => Promise.resolve(categories),
    }),
    spendings: fake<TripRepositories['spendings']>('spendings', {
      byId: (_, id) =>
        Promise.resolve((world.spendings ?? []).find((row) => row.id === id) ?? null),
      add: (_, input, rate) => {
        written.push({ rate })
        return Promise.resolve({
          spending: {
            ...spending('1 AMD', input.spentOn, rate),
            ...input,
            note: input.note ?? null,
            place: input.place ?? null,
            rate,
          },
          created: true,
        })
      },
      amend: (_, id, input, rate) => {
        written.push({ rate })
        const held = (world.spendings ?? []).find((row) => row.id === id)
        if (!held) throw new DomainError(ERROR.NOT_FOUND)
        const spending = { ...held, ...input, note: input.note ?? null, place: input.place ?? null }
        return Promise.resolve({ spending: { ...spending, rate }, amended: true })
      },
      remove: () => Promise.resolve(),
      between: (_, from, to) =>
        Promise.resolve(
          (world.spendings ?? []).filter((row) => row.spentOn >= from && row.spentOn <= to),
        ),
    }),
    money: fake<TripRepositories['money']>('money', {
      tripLines: () => Promise.resolve([]),
      frozenRate: () => Promise.resolve(world.frozen ?? frozen[0] ?? null),
      freeze: (_, __, rate) => {
        frozen.push(rate)
        return Promise.resolve(rate)
      },
    }),
  }
  return { repositories, asked, frozen, written }
}

// A dollar is 89,0115 ₽ and a dram 1/4,1 ₽: a dollar is 364,94715 ֏.
const chain = [
  exchange('89011.50 RUB', '1000 USD', '2026-08-05'),
  exchange('100000 RUB', '410000 AMD', '2026-08-05'),
]

describe('dayRates (MOL-73)', () => {
  it("prices a pair by the person's own chain, rounded once (Р-1)", async () => {
    const { repositories } = repositoriesOf({ exchanges: chain })
    const rates = await dayRates(repositories, owner)
    expect(await rates.between('USD', 'AMD', '2026-08-10')).toMatchObject({
      source: 'personal',
      scaled: parseRate('364.94715'),
    })
  })

  it('takes the bank, fresh and on the side whose number keeps its digits, without a chain', async () => {
    const { repositories } = repositoriesOf({ cache: [official('RUB', '4.30', '2026-08-20')] })
    const rates = await dayRates(repositories, owner)
    expect(await rates.between('AMD', 'RUB', '2026-08-20')).toMatchObject({
      base: 'RUB',
      quote: 'AMD',
      source: 'official',
      scaled: parseRate('4.3'),
    })
  })

  it('takes no official rate older than a week — a snapshot kept for good must not be stale (Р-4)', async () => {
    const { repositories } = repositoriesOf({ cache: [official('USD', '390', '2026-08-01')] })
    const rates = await dayRates(repositories, owner)
    expect(await rates.between('USD', 'AMD', '2026-08-08')).not.toBeNull()
    expect(await rates.between('USD', 'AMD', '2026-08-09')).toBeNull()
  })

  it('counts what came in by the bank alone, even for someone who counts by their own (Р-2)', async () => {
    const { repositories } = repositoriesOf({
      exchanges: chain,
      cache: [official('USD', '390', '2026-08-10')],
    })
    const rates = await dayRates(repositories, owner)
    expect(await rates.official('USD', 'AMD', '2026-08-10')).toMatchObject({
      source: 'official',
      scaled: parseRate('390'),
    })
  })

  it('takes the bank for someone who chose it, even with a chain', async () => {
    const { repositories } = repositoriesOf({
      preference: 'official',
      exchanges: chain,
      cache: [official('USD', '390', '2026-08-10')],
    })
    const rates = await dayRates(repositories, owner)
    expect((await rates.between('USD', 'AMD', '2026-08-10'))?.source).toBe('official')
  })
})

describe('recordSpending and amendSpending (MOL-73)', () => {
  const body = (patch: Partial<SpendingAmendBody> = {}) => ({
    spentOn: '2026-08-10',
    amount: cash('11 USD'),
    categoryId: OTHER_CATEGORY,
    ...patch,
  })

  it('reads no rate for a spending already in the spending currency', async () => {
    const { repositories, asked, written } = repositoriesOf({})
    await recordSpending(
      repositories,
      owner,
      { id: nextId(), ...body({ amount: cash('500 AMD') }) },
      NOW,
    )
    expect(asked).toEqual([])
    expect(written).toEqual([{ rate: null }])
  })

  it("refuses tomorrow in Yerevan and a category that is not the owner's", async () => {
    const { repositories } = repositoriesOf({})
    await expect(
      recordSpending(
        repositories,
        owner,
        { id: nextId(), ...body({ spentOn: '2026-09-27' }) },
        NOW,
      ),
    ).rejects.toMatchObject({ code: ERROR.SPENDING_IN_FUTURE })
    await expect(
      recordSpending(repositories, owner, { id: nextId(), ...body({ categoryId: nextId() }) }, NOW),
    ).rejects.toMatchObject({ code: ERROR.SPENDING_CATEGORY_UNKNOWN })
  })

  it("answers «not found» for someone else's spending before looking at the body (С-2)", async () => {
    const { repositories } = repositoriesOf({})
    await expect(
      amendSpending(
        repositories,
        owner,
        nextId(),
        { revision: 1, ...body({ categoryId: nextId() }) },
        NOW,
      ),
    ).rejects.toMatchObject({ code: ERROR.NOT_FOUND })
  })

  it('keeps the snapshot when only the note is corrected — and reads no rate for it', async () => {
    const snapshot = {
      base: 'USD',
      quote: 'AMD',
      scaled: parseRate('390'),
      source: 'official',
      asOf: yerevanMidnight('2026-08-10'),
    } as const
    const held = spending('11 USD', '2026-08-10', snapshot)
    const { repositories, asked, written } = repositoriesOf({ spendings: [held] })
    await amendSpending(
      repositories,
      owner,
      held.id,
      { revision: 1, ...body({ note: 'домен' }) },
      NOW,
    )
    expect(asked).toEqual([])
    expect(written).toEqual([{ rate: snapshot }])
  })

  it('takes the rate anew for another day', async () => {
    const snapshot = {
      base: 'USD',
      quote: 'AMD',
      scaled: parseRate('390'),
      source: 'official',
      asOf: yerevanMidnight('2026-08-10'),
    } as const
    const held = spending('11 USD', '2026-08-10', snapshot)
    const { repositories, written } = repositoriesOf({
      spendings: [held],
      cache: [official('USD', '400', '2026-08-12')],
    })
    await amendSpending(
      repositories,
      owner,
      held.id,
      { revision: 1, ...body({ spentOn: '2026-08-12' }) },
      NOW,
    )
    expect(written[0]?.rate?.scaled).toBe(parseRate('400'))
  })

  it('takes the rate anew for a snapshot that counts nothing — none, or into the currency before a move (Р-5)', async () => {
    const none = spending('11 USD', '2026-08-10')
    const toRoubles = spending('11 USD', '2026-08-10', {
      base: 'USD',
      quote: 'RUB',
      scaled: parseRate('89'),
      source: 'official',
      asOf: yerevanMidnight('2026-08-10'),
    })
    const { repositories, written } = repositoriesOf({
      spendings: [none, toRoubles],
      cache: [official('USD', '390', '2026-08-10')],
    })
    await amendSpending(repositories, owner, none.id, { revision: 1, ...body({ note: 'а' }) }, NOW)
    await amendSpending(
      repositories,
      owner,
      toRoubles.id,
      { revision: 1, ...body({ note: 'б' }) },
      NOW,
    )
    expect(written.map(({ rate }) => rate?.quote)).toEqual(['AMD', 'AMD'])
  })

  it("removes without making anything final — «Вернуть» is the server's ten minutes (Д6)", async () => {
    const { repositories } = repositoriesOf({})
    // The fake has no purge: reaching for one would throw.
    await expect(removeSpending(repositories, owner, nextId())).resolves.toBeUndefined()
  })
})

describe('moneyMonthOf (MOL-73)', () => {
  it('freezes a closed month by its last day once, and reads it frozen after', async () => {
    const world = repositoriesOf({
      exchanges: [exchange('100000 RUB', '410000 AMD', '2026-08-05')],
      spendings: [spending('41000 AMD', '2026-08-20')],
    })
    const first = await moneyMonthOf(world.repositories, owner, '2026-08', undefined, NOW)
    expect(first).toMatchObject({ rateKind: 'frozen', spentIncome: cash('10000 RUB') })
    expect(world.frozen).toHaveLength(1)
    await moneyMonthOf(world.repositories, owner, '2026-08', undefined, NOW)
    expect(world.frozen).toHaveLength(1)
  })

  it('never freezes the running month', async () => {
    const world = repositoriesOf({
      exchanges: [exchange('100000 RUB', '410000 AMD', '2026-09-05')],
    })
    const view = await moneyMonthOf(world.repositories, owner, '2026-09', undefined, NOW)
    expect(view.rateKind).toBe('live')
    expect(world.frozen).toEqual([])
  })

  it('counts an income by the bank of its day, not by what the money held cost (Р-2)', async () => {
    const world = repositoriesOf({
      exchanges: [exchange('100000 RUB', '410000 AMD', '2026-08-05')],
      incomes: [income('150000 AMD', '2026-08-20')],
      cache: [official('RUB', '4.30', '2026-08-20')],
    })
    const view = await moneyMonthOf(world.repositories, owner, '2026-08', undefined, NOW)
    expect(view.income).toEqual(cash('34883.72 RUB'))
  })

  it('counts a spending with no snapshot by the rule of its day, as a trip line (Р-5)', async () => {
    const world = repositoriesOf({
      exchanges: chain,
      spendings: [spending('10 USD', '2026-08-20')],
    })
    const view = await moneyMonthOf(world.repositories, owner, '2026-08', undefined, NOW)
    expect(view.spent).toEqual(cash('3649.47 AMD'))
  })

  it('compares with no previous month when that month holds nothing', async () => {
    const world = repositoriesOf({ spendings: [spending('500 AMD', '2026-08-20')] })
    const view = await moneyMonthOf(world.repositories, owner, '2026-08', undefined, NOW)
    expect(view.previousSpent).toBeNull()
  })
})
