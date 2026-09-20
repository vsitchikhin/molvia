import { describe, expect, it } from 'vitest'
import { ERROR, actorSchema, unitPrice } from '@molvia/model'
import type { Actor, Money, Quantity } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { EventRepository, RecordedEvent } from '@/db/events-repository'
import type { ExpenseRepository, PlacePrice, PriceMedian } from '@/db/expenses-repository'
import type { AdviceVerdictRow, VerdictRepository } from '@/db/verdicts-repository'
import { advice } from './advice'

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const BEEF = '0b6f2c4e-8d1a-4f3b-9c7e-5a2d1e0f3b4c'
const CHEESE = '1c7a3d5f-9e2b-4a4c-8d8f-6b3e2f1a4c5d'
const MARKET = '2b7a1f30-5c8d-4a2e-9f11-6d3c8e0b4a57'
const SAS = '3c8b2a41-6d9e-4b3f-8a22-7e4d9f1c5b68'

const kilo: Quantity = { milli: 1000n, unit: 'kg' }
const amd = (minor: number): Money => ({ minor: BigInt(minor), currency: 'AMD' })
const perKilo = (minor: number) => unitPrice(amd(minor), kilo).scaledMinor

function actor(sharedUntil: Date | null = null): Actor {
  return actorSchema.parse({
    id: ACTOR,
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    sharedUntil,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
  })
}

function rated(patch: Partial<AdviceVerdictRow> & { sum: number }): AdviceVerdictRow {
  return { itemId: BEEF, name: 'Говядина, вырезка', count: 1, review: null, ...patch }
}

function price(patch: Partial<PlacePrice> & { scaledMinor: bigint }): PlacePrice {
  return {
    itemId: BEEF,
    placeId: MARKET,
    placeName: 'Рынок в Гюмри',
    currency: 'AMD',
    unit: 'kg',
    observations: 1,
    latestAt: new Date('2026-09-18T10:00:00.000Z'),
    ...patch,
  }
}

function median(patch: Partial<PriceMedian> & { scaledMinor: bigint }): PriceMedian {
  return { itemId: BEEF, currency: 'AMD', unit: 'kg', observations: 3, ...patch }
}

interface World {
  readonly actor?: Actor | null
  readonly rows?: AdviceVerdictRow[]
  readonly prices?: PlacePrice[]
  readonly medians?: PriceMedian[]
  readonly recorded?: RecordedEvent[]
  readonly pricedItems?: string[][]
}

/** Every method throws unless this screen is meant to reach it. */
function deps(world: World = {}) {
  const recorded = world.recorded ?? []
  const pricedItems = world.pricedItems ?? []

  const actors: ActorRepository = {
    create: () => Promise.reject(new Error('create was not expected')),
    byId: () => Promise.resolve(world.actor === undefined ? actor() : world.actor),
    update: () => Promise.reject(new Error('update was not expected')),
  }

  const verdicts: VerdictRepository = {
    put: () => Promise.reject(new Error('put was not expected')),
    amend: () => Promise.reject(new Error('amend was not expected')),
    withdraw: () => Promise.reject(new Error('withdraw was not expected')),
    forItem: () => Promise.reject(new Error('forItem was not expected')),
    listFor: () => Promise.reject(new Error('listFor was not expected')),
    adviceRowsFor: () => Promise.resolve(world.rows ?? []),
  }

  const expenses: ExpenseRepository = {
    add: () => Promise.reject(new Error('add was not expected')),
    forTrip: () => Promise.reject(new Error('forTrip was not expected')),
    update: () => Promise.reject(new Error('update was not expected')),
    remove: () => Promise.reject(new Error('remove was not expected')),
    unratedFor: () => Promise.reject(new Error('unratedFor was not expected')),
    pendingVerdictsFor: () => Promise.reject(new Error('pendingVerdictsFor was not expected')),
    cheapestFor: (query) => {
      pricedItems.push([...query.itemIds])
      return Promise.resolve(world.prices ?? [])
    },
    medianPriceFor: () => Promise.resolve(world.medians ?? []),
  }

  const events: EventRepository = {
    record: () => Promise.reject(new Error('record was not expected')),
    recordOncePerDay: (event) => {
      recorded.push(event)
      return Promise.resolve(true)
    },
    weekFourReturn: () => Promise.reject(new Error('weekFourReturn was not expected')),
  }

  return { actors, verdicts, expenses, events }
}

describe('три группы', () => {
  it('раскладывает по оценке: 4 и 5 — брать, 3 — если дёшево, 1 и 2 — не брать', async () => {
    const rows = [
      rated({ itemId: BEEF, sum: 4 }),
      rated({ itemId: CHEESE, sum: 3 }),
      rated({ itemId: SAS, sum: 2 }),
    ]

    const answer = await advice(deps({ rows, medians: [] }), ACTOR)

    expect(answer.rows.map((row) => row.level)).toEqual(['take', 'if_cheap', 'never'])
  })

  it('не спрашивает цены для «не брать нигде» — не фильтрует ответ, а не спрашивает', async () => {
    const pricedItems: string[][] = []
    const rows = [rated({ itemId: BEEF, sum: 5 }), rated({ itemId: CHEESE, sum: 1 })]

    await advice(deps({ rows, pricedItems }), ACTOR)

    expect(pricedItems).toEqual([[BEEF]])
  })

  it('отдаёт «не брать» вовсе без полей цены', async () => {
    const rows = [rated({ sum: 1, review: 'Пахнет крахмалом' })]

    const [row] = (await advice(deps({ rows, prices: [price({ scaledMinor: 1n })] }), ACTOR)).rows

    expect(row).toEqual({
      itemId: BEEF,
      name: 'Говядина, вырезка',
      level: 'never',
      rating: '1.0',
      ratingsCount: 1,
      review: 'Пахнет крахмалом',
    })
  })
})

describe('места и порог', () => {
  it('сортирует места по возрастанию цены за единицу', async () => {
    const prices = [
      price({ placeId: SAS, placeName: 'SAS', scaledMinor: perKilo(510_000) }),
      price({ placeId: MARKET, scaledMinor: perKilo(479_000) }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual([
      'Рынок в Гюмри',
      'SAS',
    ])
  })

  it('показывает порог с трёх наблюдений и молчит на двух', async () => {
    const rows = [rated({ sum: 3 })]
    const prices = [price({ scaledMinor: perKilo(320_000) })]

    const enough = (
      await advice(
        deps({ rows, prices, medians: [median({ scaledMinor: perKilo(300_000) })] }),
        ACTOR,
      )
    ).rows[0]
    const few = (
      await advice(
        deps({
          rows,
          prices,
          medians: [median({ scaledMinor: perKilo(300_000), observations: 2 })],
        }),
        ACTOR,
      )
    ).rows[0]

    expect(enough?.level === 'if_cheap' && enough.threshold?.scaledMinor).toBe(perKilo(300_000))
    expect(few?.level === 'if_cheap' && few.threshold).toBeNull()
  })

  it('оценённое, но ни разу не купленное приходит без ценового блока', async () => {
    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices: [] }), ACTOR)).rows

    expect(row?.level === 'take' && row.places).toEqual([])
  })

  it('берёт группу с бóльшим числом наблюдений, а не последнюю покупку', async () => {
    const prices = [
      price({ scaledMinor: perKilo(479_000), observations: 8 }),
      price({
        currency: 'RUB',
        scaledMinor: 1n,
        observations: 1,
        latestAt: new Date('2026-09-19T10:00:00.000Z'),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places).toHaveLength(1)
    expect(row?.level === 'take' && row.places[0]?.unitPrice.currency).toBe('AMD')
  })

  it('при равном числе наблюдений решает последняя покупка', async () => {
    const prices = [
      price({ scaledMinor: perKilo(479_000), latestAt: new Date('2026-09-01T10:00:00.000Z') }),
      price({
        currency: 'RUB',
        scaledMinor: 1n,
        latestAt: new Date('2026-09-19T10:00:00.000Z'),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places[0]?.unitPrice.currency).toBe('RUB')
  })

  it('берёт порог той же группы, что и места', async () => {
    const prices = [
      price({ scaledMinor: perKilo(320_000), observations: 5 }),
      price({ currency: 'RUB', scaledMinor: 1n, observations: 1 }),
    ]
    const medians = [
      median({ currency: 'RUB', scaledMinor: 9n }),
      median({ scaledMinor: perKilo(300_000) }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 3 })], prices, medians }), ACTOR)).rows

    expect(row?.level === 'if_cheap' && row.threshold?.currency).toBe('AMD')
  })
})

describe('режим ответа', () => {
  it('без доступа — свой, и события нет', async () => {
    const recorded: RecordedEvent[] = []

    const answer = await advice(deps({ rows: [rated({ sum: 5 })], recorded }), ACTOR)

    expect(answer.scope).toBe('own')
    expect(recorded).toEqual([])
  })

  it('с доступом — общий, и просмотр записан раз в сутки', async () => {
    const recorded: RecordedEvent[] = []
    const until = new Date(Date.now() + 86_400_000)

    const answer = await advice(
      deps({ actor: actor(until), rows: [rated({ sum: 13, count: 3 })], recorded }),
      ACTOR,
    )

    expect(answer.scope).toBe('shared')
    expect(answer.rows[0]?.rating).toBe('4.3')
    expect(answer.rows[0]?.ratingsCount).toBe(3)
    expect(recorded).toEqual([
      { actorId: ACTOR, type: 'advice_viewed', payload: { subject: 'product' } },
    ])
  })

  it('истёкший доступ — это отсутствие доступа', async () => {
    const answer = await advice(
      deps({ actor: actor(new Date(Date.now() - 1000)), rows: [] }),
      ACTOR,
    )

    expect(answer.scope).toBe('own')
  })

  it('не проглатывает сбой записи события: потерянная строка занижает ворота', async () => {
    const world = deps({ actor: actor(new Date(Date.now() + 86_400_000)), rows: [] })
    const events: EventRepository = {
      ...world.events,
      recordOncePerDay: () => Promise.reject(new Error('log down')),
    }

    await expect(advice({ ...world, events }, ACTOR)).rejects.toThrow('log down')
  })
})

describe('личность', () => {
  it('отвечает «нет такого владельца», а не пустым экраном', async () => {
    await expect(advice(deps({ actor: null }), ACTOR)).rejects.toThrow(
      expect.objectContaining({ code: ERROR.NO_ACTOR }),
    )
  })

  it('пустой список — это пустой список, а не ошибка', async () => {
    expect((await advice(deps({ rows: [] }), ACTOR)).rows).toEqual([])
  })
})
