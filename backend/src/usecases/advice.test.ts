import { describe, expect, it } from 'vitest'
import { ERROR, actorSchema, itemSchema, unitPrice } from '@molvia/model'
import type { Actor, Item, Money, Quantity } from '@molvia/model'
import type { ActorRepository } from '@/db/actors-repository'
import type { EventRepository, RecordedEvent } from '@/db/events-repository'
import type {
  ExpenseRepository,
  PlacePrice,
  PriceMedian,
  PriceQuery,
} from '@/db/expenses-repository'
import type { ItemRepository } from '@/db/items-repository'
import { NO_EMBEDDER } from '@/embeddings/embedder'
import type { AdviceQuery, AdviceVerdictRow, VerdictRepository } from '@/db/verdicts-repository'
import { ADVICE_SEARCH_CANDIDATES, advice, adviceSearch } from './advice'
import { SEARCH_LIMIT } from './search-catalogue'

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
    telegramUserId: 777_000_123,
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
  return { itemId: BEEF, name: 'Говядина, вырезка', count: 1, review: null, isMine: true, ...patch }
}

/** A place alone in its pair unless the pair's weight is named. */
function price(patch: Partial<PlacePrice> & { scaledMinor: bigint }): PlacePrice {
  const observations = patch.observations ?? 1
  const latestVisitAt = patch.latestVisitAt ?? new Date('2026-09-18T10:00:00.000Z')
  return {
    itemId: BEEF,
    placeId: MARKET,
    placeName: 'Рынок в Гюмри',
    placeCity: 'Гюмри',
    currency: 'AMD',
    unit: 'kg',
    observations,
    latestVisitAt,
    pairObservations: observations,
    pairLatestVisitAt: latestVisitAt,
    nearby: true,
    recent: true,
    ...patch,
  }
}

function median(patch: Partial<PriceMedian> & { scaledMinor: bigint }): PriceMedian {
  return { itemId: BEEF, currency: 'AMD', unit: 'kg', observations: 3, ...patch }
}

interface World {
  readonly actor?: Actor | null
  readonly rows?: AdviceVerdictRow[]
  readonly total?: number
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
    createIfMissing: () => Promise.reject(new Error('createIfMissing was not expected')),
    byId: () => Promise.resolve(world.actor === undefined ? actor() : world.actor),
    byTelegramUserId: () => Promise.reject(new Error('byTelegramUserId was not expected')),
    update: () => Promise.reject(new Error('update was not expected')),
    lockAccount: () => Promise.reject(new Error('lockAccount was not expected')),
  }

  const verdicts: VerdictRepository = {
    put: () => Promise.reject(new Error('put was not expected')),
    amend: () => Promise.reject(new Error('amend was not expected')),
    withdraw: () => Promise.reject(new Error('withdraw was not expected')),
    forItem: () => Promise.reject(new Error('forItem was not expected')),
    listFor: () => Promise.reject(new Error('listFor was not expected')),
    adviceRowsFor: () =>
      Promise.resolve({ rows: world.rows ?? [], total: world.total ?? (world.rows ?? []).length }),
    reachedRatings: () => Promise.reject(new Error('reachedRatings was not expected')),
  }

  const expenses: ExpenseRepository = {
    add: () => Promise.reject(new Error('add was not expected')),
    forTrip: () => Promise.reject(new Error('forTrip was not expected')),
    update: () => Promise.reject(new Error('update was not expected')),
    remove: () => Promise.reject(new Error('remove was not expected')),
    unratedFor: () => Promise.reject(new Error('unratedFor was not expected')),
    pendingVerdictsFor: () => Promise.reject(new Error('pendingVerdictsFor was not expected')),
    placePricesFor: (query) => {
      pricedItems.push([...query.itemIds])
      return Promise.resolve(world.prices ?? [])
    },
    medianPriceFor: () => Promise.resolve(world.medians ?? []),
    ownLatestFor: () => Promise.reject(new Error('ownLatestFor was not expected')),
    ownItemsOfKind: () => Promise.reject(new Error('ownItemsOfKind was not expected')),
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
      isMine: true,
    })
  })

  it('говорит, своя ли за строкой оценка: в общем режиме строка бывает целиком чужой', async () => {
    // Иначе экран предлагает изменить мнение, которого человек не высказывал, и любое
    // сохранение упирается в 404 (MOL-32, А2). Отличить нечем: отзыв у чужой строки пуст
    // ровно так же, как у своей оценки без отзыва.
    const rows = [
      rated({ sum: 5, count: 1, itemId: BEEF }),
      rated({ sum: 12, count: 3, itemId: CHEESE, name: 'Сыр «Чанах»', isMine: false }),
    ]

    const answer = await advice(
      deps({ actor: actor(new Date(Date.now() + 86_400_000)), rows }),
      ACTOR,
    )

    expect(answer.rows.map((row) => row.isMine)).toEqual([true, false])
  })
})

describe('места и порог', () => {
  it('не переставляет места: порядок задан выборкой, и он же у строк ответа', async () => {
    // Сортировать их здесь ещё раз значило бы сравнивать названия другим алфавитом, чем тот,
    // которым база упорядочила строки, — один ответ в двух порядках (ревью 1, F7). Сам порядок
    // закреплён интеграционным тестом, на настоящей коллации.
    const prices = [
      price({ placeId: MARKET, scaledMinor: perKilo(479_000) }),
      price({ placeId: SAS, placeName: 'SAS', scaledMinor: perKilo(510_000) }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual([
      'Рынок в Гюмри',
      'SAS',
    ])
  })

  it('несёт город каждого места — экран назовёт его, где имя повторяется (MOL-120)', async () => {
    const prices = [
      price({ placeId: MARKET, placeName: 'Ереван Сити', scaledMinor: perKilo(479_000) }),
      price({
        placeId: SAS,
        placeName: 'Ереван Сити',
        placeCity: 'Ереван',
        nearby: false,
        scaledMinor: perKilo(450_000),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places.map(({ name, city }) => [name, city])).toEqual([
      ['Ереван Сити', 'Гюмри'],
      ['Ереван Сити', 'Ереван'],
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

  it('ставит первой группу с бóльшим числом наблюдений, а не последнюю покупку', async () => {
    const prices = [
      price({ scaledMinor: perKilo(479_000), observations: 8 }),
      price({
        currency: 'RUB',
        scaledMinor: 1n,
        observations: 1,
        latestVisitAt: new Date('2026-09-19T10:00:00.000Z'),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    // Другая пара не пропадает, а идёт следом (адверсариальный Е).
    expect(row?.level === 'take' && row.places.map((place) => place.unitPrice.currency)).toEqual([
      'AMD',
      'RUB',
    ])
  })

  it('взвешивает пару всеми её покупками, а не местами, которые она называет (адверсариальный Д)', async () => {
    // SAS: десять кило, потом пачка — место названо пачкой; рынок: одно кило. Пара «кг» весит 11.
    const prices = [
      price({ scaledMinor: perKilo(240_000), observations: 1, pairObservations: 11 }),
      price({
        placeId: SAS,
        placeName: 'SAS',
        unit: 'piece',
        scaledMinor: 120_000n,
        observations: 1,
        latestVisitAt: new Date('2026-10-01T10:00:00.000Z'),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    // Строка в кило; SAS, чья последняя покупка — пачка, — следом, со своей единицей (Е).
    expect(
      row?.level === 'take' && row.places.map((place) => [place.name, place.unitPrice.unit]),
    ).toEqual([
      ['Рынок в Гюмри', 'kg'],
      ['SAS', 'piece'],
    ])
  })

  it('ставит первой пару с местом своего города, хоть она и легче (Р-26, адверсариальный Ж)', async () => {
    const prices = [
      price({
        placeName: 'SAS Ереван',
        scaledMinor: perKilo(260_000),
        observations: 3,
        nearby: false,
      }),
      price({ placeId: SAS, placeName: 'Рынок', unit: 'piece', scaledMinor: 120_000n }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual([
      'Рынок',
      'SAS Ереван',
    ])
  })

  it('давнее место своего города не ставит свою пару первой (селфревью №12)', async () => {
    const prices = [
      price({
        placeName: 'SAS Ереван',
        scaledMinor: perKilo(260_000),
        observations: 30,
        nearby: false,
      }),
      price({
        placeId: SAS,
        placeName: 'Рынок',
        unit: 'piece',
        scaledMinor: 120_000n,
        recent: false,
        latestVisitAt: new Date('2024-10-02T09:00:00.000Z'),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    // Пара кило первой; двухлетняя пачка — место другой пары вне окна — со строки уходит (И).
    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual(['SAS Ереван'])
  })

  it('место другой пары — на строке, только пока брали там в окне (адверсариальный И)', async () => {
    const prices = [
      price({ scaledMinor: perKilo(240_000), observations: 3 }),
      price({ placeId: SAS, placeName: 'SAS', scaledMinor: perKilo(260_000) }),
      price({
        placeId: CHEESE,
        placeName: 'Пятёрочка',
        currency: 'RUB',
        scaledMinor: 1n,
        nearby: false,
        recent: false,
        latestVisitAt: new Date('2024-10-02T09:00:00.000Z'),
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual([
      'Рынок в Гюмри',
      'SAS',
    ])
  })

  it('не прячет место другой пары, свежее первого места строки (раунд 6, К; решение Н)', async () => {
    const prices = [
      price({
        scaledMinor: perKilo(240_000),
        pairObservations: 11,
        latestVisitAt: new Date('2025-08-28T09:00:00.000Z'),
        recent: false,
      }),
      price({
        placeId: SAS,
        placeName: 'SAS',
        unit: 'piece',
        scaledMinor: 120_000n,
        latestVisitAt: new Date('2026-06-24T09:00:00.000Z'),
        recent: false,
      }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    // Окно SAS не держит, но рынок, который строка называет, ещё старше.
    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual([
      'Рынок в Гюмри',
      'SAS',
    ])
  })

  it('«Ещё» — свой город первым и через пары (Р-26, адверсариальный Ж′)', async () => {
    const prices = [
      price({ scaledMinor: perKilo(240_000), observations: 3 }),
      price({
        placeId: SAS,
        placeName: 'SAS Ереван',
        scaledMinor: perKilo(260_000),
        nearby: false,
      }),
      price({ placeId: CHEESE, placeName: 'Магазин у дома', unit: 'piece', scaledMinor: 120_000n }),
    ]

    const [row] = (await advice(deps({ rows: [rated({ sum: 5 })], prices }), ACTOR)).rows

    expect(row?.level === 'take' && row.places.map((place) => place.name)).toEqual([
      'Рынок в Гюмри',
      'Магазин у дома',
      'SAS Ереван',
    ])
  })

  it('при равном числе наблюдений решает последняя покупка', async () => {
    const prices = [
      price({ scaledMinor: perKilo(479_000), latestVisitAt: new Date('2026-09-01T10:00:00.000Z') }),
      price({
        currency: 'RUB',
        scaledMinor: 1n,
        latestVisitAt: new Date('2026-09-19T10:00:00.000Z'),
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

describe('поиск «Что брать» (MOL-128)', () => {
  const BREAD = '4d9c3b52-7e0f-4c4a-9b33-8f5e0a2d6c79'

  function item(id: string, name: string): Item {
    return itemSchema.parse({
      id,
      kind: 'product',
      name,
      searchKey: name.toLowerCase(),
      barcodes: [],
      note: null,
      defaultUnit: 'kg',
      typicalQuantity: null,
      createdBy: null,
      createdAt: new Date('2026-09-18T10:00:00.000Z'),
    })
  }

  function searching(world: World, found: Item[], near = true) {
    const all = deps(world)
    const asked: AdviceQuery[] = []
    const searched: unknown[][] = []
    const verdicts: VerdictRepository = {
      ...all.verdicts,
      adviceRowsFor: (query) => {
        asked.push(query)
        return all.verdicts.adviceRowsFor(query)
      },
    }
    const items: ItemRepository = {
      create: () => Promise.reject(new Error('create was not expected')),
      byId: () => Promise.reject(new Error('byId was not expected')),
      byIds: () => Promise.reject(new Error('byIds was not expected')),
      createUnlessNamed: () => Promise.reject(new Error('createUnlessNamed was not expected')),
      byBarcode: () => Promise.reject(new Error('byBarcode was not expected')),
      nodes: () => Promise.reject(new Error('nodes was not expected')),
      attachBarcode: () => Promise.reject(new Error('attachBarcode was not expected')),
      detachBarcode: () => Promise.reject(new Error('detachBarcode was not expected')),
      search: (...args) => {
        searched.push(args)
        return Promise.resolve({ items: found, near, nearIds: near ? found.map((i) => i.id) : [] })
      },
    }
    const { actors, expenses } = all
    return { deps: { actors, verdicts, expenses, items, embedder: NO_EMBEDDER }, asked, searched }
  }

  it('отвечает в порядке поиска: у оценённого — его строка, у неоценённого — null', async () => {
    const world = searching({ rows: [rated({ itemId: CHEESE, name: 'Сыр Лори', sum: 5 })] }, [
      item(BREAD, 'Сыр косичка'),
      item(CHEESE, 'Сыр Лори'),
    ])

    const answer = await adviceSearch(world.deps, ACTOR, 'syr')

    expect(answer.items.map((found) => [found.name, found.advice?.level ?? null])).toEqual([
      ['Сыр косичка', null],
      ['Сыр Лори', 'take'],
    ])
    expect(world.searched).toEqual([['syr', ADVICE_SEARCH_CANDIDATES, ACTOR, null]])
  })

  // Adversarial А: «сыр» is 24 names in the seed. Cut at twenty before the verdicts, the one rated
  // «не брать нигде» was gone and twenty «ещё не оценивали» stood in its place.
  it('оценённое за пределом поиска не отрезано: первые двадцать и всё близкое с оценкой', async () => {
    const id = (n: number) => `4d9c3b52-7e0f-4c4a-9b33-${String(n).padStart(12, '0')}`
    const cheeses = Array.from({ length: SEARCH_LIMIT + 4 }, (_, n) =>
      item(id(n), `Сыр ${String(n)}`),
    )
    const warned = cheeses[SEARCH_LIMIT + 2]
    const far = cheeses[SEARCH_LIMIT + 3]
    if (!warned || !far) throw new Error('no cheese')
    const world = searching(
      {
        rows: [
          rated({ itemId: warned.id, name: warned.name, sum: 1 }),
          rated({ itemId: far.id, name: far.name, sum: 5 }),
        ],
      },
      cheeses,
    )
    // Every one near but the last: a guess of the catalogue's, two edits away.
    const catalogue = world.deps.items
    world.deps.items = {
      ...catalogue,
      search: async (...args) => ({
        ...(await catalogue.search(...args)),
        nearIds: cheeses.slice(0, -1).map((cheese) => cheese.id),
      }),
    }

    const answer = await adviceSearch(world.deps, ACTOR, 'сыр')

    expect(answer.items).toHaveLength(SEARCH_LIMIT + 1)
    expect(answer.items.at(-1)).toMatchObject({ name: warned.name, advice: { level: 'never' } })
    expect(answer.items.map((found) => found.itemId)).not.toContain(far.id)
    // Asked about the twenty shown and the near past them — not the far one.
    expect(world.asked[0]?.itemIds).toHaveLength(SEARCH_LIMIT + 3)
    expect(answer.near).toBe(true)
  })

  it('спрашивает оценки только найденного и не режет их пределом списка', async () => {
    const world = searching({ rows: [] }, [item(BREAD, 'Хлеб'), item(CHEESE, 'Сыр')])

    await adviceSearch(world.deps, ACTOR, 'х')

    expect(world.asked.map((query) => [query.itemIds, query.limit])).toEqual([[[BREAD, CHEESE], 2]])
  })

  it('«не брать нигде» и в поиске без цены: о её цене даже не спрашивают', async () => {
    const pricedItems: string[][] = []
    const world = searching(
      {
        rows: [rated({ itemId: CHEESE, name: 'Сыр Чанах', sum: 2 })],
        prices: [price({ itemId: CHEESE, scaledMinor: perKilo(2500) })],
        pricedItems,
      },
      [item(CHEESE, 'Сыр Чанах')],
    )

    const [found] = (await adviceSearch(world.deps, ACTOR, 'сыр')).items

    expect(found?.advice).not.toHaveProperty('places')
    expect(found?.advice).not.toHaveProperty('threshold')
    expect(pricedItems).toEqual([[]])
  })

  it('визита не пишет и в общем режиме: его пишет список (В-2)', async () => {
    const recorded: RecordedEvent[] = []
    const world = searching({ actor: actor(new Date(Date.now() + 86_400_000)), recorded }, [
      item(CHEESE, 'Сыр'),
    ])

    const answer = await adviceSearch(world.deps, ACTOR, 'сыр')

    expect(answer.scope).toBe('shared')
    expect(recorded).toEqual([])
  })

  it('ничего не нашли — оценки не спрашивает, «далеко» передаёт как есть', async () => {
    const world = searching({}, [], false)

    const answer = await adviceSearch(world.deps, ACTOR, 'кускус')

    expect(answer).toMatchObject({ items: [], near: false, scope: 'own' })
    expect(world.asked).toEqual([])
  })

  it('без владельца — «нет такого владельца», не пустой ответ', async () => {
    const world = searching({ actor: null }, [])

    await expect(adviceSearch(world.deps, ACTOR, 'сыр')).rejects.toThrow(
      expect.objectContaining({ code: ERROR.NO_ACTOR }),
    )
  })
})

describe('зона телефона (MOL-166)', () => {
  function asking(rows: AdviceVerdictRow[]) {
    const all = deps({ rows })
    const queries: PriceQuery[] = []
    const expenses: ExpenseRepository = {
      ...all.expenses,
      placePricesFor: (query) => {
        queries.push(query)
        return Promise.resolve([])
      },
    }
    return { deps: { ...all, expenses }, queries }
  }

  it('доходит до цен мест: «последняя» читается в той же зоне, что на листе', async () => {
    const { deps: withZone, queries } = asking([rated({ itemId: BEEF, sum: 5 })])

    await advice(withZone, ACTOR, { zone: 'Asia/Tokyo' })

    expect(queries.map((query) => query.zone)).toEqual(['Asia/Tokyo'])
  })

  it('несёт и сегодня телефона — от него окно чужих цен', async () => {
    const { deps: withToday, queries } = asking([rated({ itemId: BEEF, sum: 5 })])

    await advice(withToday, ACTOR, { today: '2026-10-02', zone: 'Asia/Yerevan' })

    expect(queries.map(({ today, zone }) => ({ today, zone }))).toEqual([
      { today: '2026-10-02', zone: 'Asia/Yerevan' },
    ])
  })

  it('без зоны поля нет вовсе — репозиторий берёт Ереван', async () => {
    const { deps: withoutZone, queries } = asking([rated({ itemId: BEEF, sum: 5 })])

    await advice(withoutZone, ACTOR)

    expect(queries).toHaveLength(1)
    expect(queries[0]).not.toHaveProperty('zone')
    expect(queries[0]).not.toHaveProperty('today')
  })
})
