import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EXPORT_FORMAT, EXPORT_VERSION, exportFileCodec } from '#model/contracts/export'
import type { ExportFile } from '#model/contracts/export'
import { money } from '#model/values/money'

const at = new Date('2026-09-20T10:00:00.000Z')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const rate = {
  base: 'RUB',
  quote: 'AMD',
  scaled: 4_812_345n,
  source: 'official',
  asOf: at,
} as const

const file: ExportFile = {
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  exportedAt: at,
  account: {
    id: id(1),
    telegramUserId: 510_000_001,
    country: 'AM',
    city: 'Гюмри',
    spendCurrency: 'AMD',
    incomeCurrency: 'RUB',
    incomeCurrencySince: null,
    ratePreference: 'personal',
    salaryShiftDay: 25,
    remindersOff: null,
    receiptNoticesOff: false,
    botBlockedAt: null,
    consentVersion: 1,
    consentedAt: at,
    analyticsOffAt: null,
    analyticsOnAt: at,
    sharedUntil: null,
    createdAt: at,
    updatedAt: at,
  },
  sessions: [
    {
      id: id(2),
      deviceName: 'iPhone',
      current: true,
      createdAt: at,
      lastSeenAt: at,
      expiresAt: at,
    },
  ],
  loginRequests: [{ id: id(3), deviceName: null, createdAt: at, expiresAt: at, consumedAt: at }],
  trips: [
    {
      id: id(4),
      placeId: id(5),
      currency: 'AMD',
      rate,
      rateProvider: 'cba',
      rateJumped: true,
      ratePrevious: { scaled: 4_700_000n, asOf: at },
      rateManual: null,
      rateChoice: 'previous',
      startedAt: at,
      finishedAt: null,
      finishedOnDeviceAt: null,
      startedOn: '2026-09-18',
      finishedOn: null,
      accountId: id(6),
      debited: money(520_000n, 'AMD'),
      accountSetAt: at,
      receipt: money(1_240_000n, 'AMD'),
      receiptSetAt: at,
      receiptFirstAt: at,
      removedAt: at,
    },
  ],
  expenses: [
    {
      id: id(7),
      tripId: id(4),
      itemId: id(8),
      quantity: { milli: 900n, unit: 'l' },
      amount: money(52_000n, 'AMD'),
      createdAt: at,
    },
    { id: id(9), tripId: id(4), itemId: id(8), quantity: null, amount: null, createdAt: at },
  ],
  verdicts: [
    {
      id: id(10),
      itemId: id(8),
      itemKind: 'product',
      placeId: null,
      score: 1,
      review: null,
      ratedAt: at,
      updatedAt: at,
      withdrawnAt: at,
    },
  ],
  searchPicks: [{ queryKey: 'moloko', itemId: id(8), picks: 3, lastPickedAt: at, admits: false }],
  ratingReminders: [
    { step: 2, remindedOn: '2026-09-23', remindedAt: at, windowFrom: '2026-09-19' },
  ],
  events: [
    { id: '41', occurredAt: at, type: 'advice_viewed', payload: { subject: 'product' } },
    { id: '7', occurredAt: at, type: 'session_started', payload: {} },
  ],
  exchanges: [
    {
      id: id(11),
      given: money(1_000_000n, 'RUB'),
      received: money(4_700_000n, 'AMD'),
      exchangedOn: '2026-09-20',
      heldBefore: money(11_500_000n, 'AMD'),
      note: 'Рате, Абовяна',
      channel: 'exchanger',
      givenAccountId: null,
      receivedAccountId: id(6),
      accountSetAt: at,
      revision: 2,
      createdAt: at,
      amendedAt: at,
      removedAt: null,
      earlierVersions: [
        {
          revision: 1,
          given: money(1_000_000n, 'RUB'),
          received: money(4_600_000n, 'AMD'),
          exchangedOn: '2026-09-19',
          heldBefore: null,
          note: null,
          channel: null,
          replacedAt: at,
        },
      ],
    },
  ],
  incomes: [
    {
      id: id(12),
      amount: money(9_961_500n, 'RUB'),
      receivedOn: '2026-09-15',
      heldBefore: null,
      source: 'salary',
      note: null,
      accountId: null,
      accountSetAt: null,
      revision: 1,
      createdAt: at,
      amendedAt: null,
      removedAt: null,
      earlierVersions: [],
    },
  ],
  spendings: [
    {
      id: id(13),
      spentOn: '2026-09-20',
      amount: money(500_000n, 'RUB'),
      categoryId: id(14),
      note: 'барбер',
      place: null,
      rate,
      accountId: null,
      debited: null,
      accountSetAt: null,
      transferId: id(70),
      revision: 1,
      createdAt: at,
      amendedAt: null,
      removedAt: null,
    },
  ],
  transfers: [
    {
      id: id(70),
      fromAccountId: id(71),
      toAccountId: id(72),
      amount: money(200_000n, 'USD'),
      transferredOn: '2026-10-08',
      note: null,
      revision: 2,
      createdAt: at,
      amendedAt: at,
      removedAt: null,
      earlierVersions: [
        {
          revision: 1,
          fromAccountId: id(71),
          toAccountId: id(72),
          amount: money(150_000n, 'USD'),
          fee: money(2_000n, 'USD'),
          transferredOn: '2026-10-08',
          note: null,
          replacedAt: at,
        },
      ],
    },
  ],
  receipts: [
    {
      id: id(30),
      status: 'parsed',
      failure: null,
      source: 'photo',
      parts: 2,
      country: 'AM',
      language: 'ru',
      currency: 'AMD',
      capturedAt: at,
      createdAt: at,
      queuedAt: at,
      readingAt: at,
      readAt: at,
      attempts: 1,
      readerVersion: 'tesseract 5.5.0 · dc2c9f36ac9d',
      layout: 'card',
      nextAttemptAt: null,
      via: null,
      qrMissed: null,
      tin: '01282006',
      shopUnit: null,
      shop: null,
      printedOn: '2026-09-30',
      printedTime: '15:03',
      receiptNo: '21410811',
      total: money(74_000n, 'AMD'),
      balanced: true,
      city: 'Гюмри',
      recordedAt: at,
      heard: 'bot',
      heardAt: at,
      tripId: id(4),
      removedAt: null,
      lines: [
        {
          position: 0,
          printed: 'Կաթ «Իգիթ» 3.2% 1լ',
          hs: '0401',
          sku: '1163909',
          quantity: { milli: 2_000n, unit: 'piece' },
          price: money(37_000n, 'AMD'),
          sum: money(74_000n, 'AMD'),
          discount: money(0n, 'AMD'),
          settled: true,
          itemId: id(8),
          match: 'search',
          translation: 'молоко',
          gtin: null,
          expenseId: id(9),
        },
      ],
    },
  ],
  spendingCategories: [
    { id: id(14), preset: null, name: 'Такси', colour: 0, archivedAt: null, createdAt: at },
  ],
  monthRates: [{ month: '2026-08', rate: { ...rate, source: 'personal' } }],
  budgetPlans: [
    {
      categoryId: id(14),
      from: '2026-09',
      plan: { kind: 'amount', amount: money(25_000_000n, 'AMD') },
      updatedAt: at,
    },
    { categoryId: null, from: '2026-09', plan: { kind: 'share', percent: 25 }, updatedAt: at },
    { categoryId: id(14), from: '2026-11', plan: null, updatedAt: at },
  ],
  moneyAccounts: [
    {
      id: id(6),
      name: 'Наличные ֏',
      currency: 'AMD',
      savings: false,
      start: money(24_153_000n, 'AMD'),
      startOn: '2026-09-16',
      revision: 1,
      createdOn: '2026-09-27',
      createdAt: at,
      archivedAt: null,
      removedAt: null,
    },
  ],
  accountChecks: [
    {
      id: id(15),
      accountId: id(6),
      checkedOn: '2026-09-26',
      fact: money(18_500_000n, 'AMD'),
      counted: money(19_013_200n, 'AMD'),
      createdAt: at,
    },
  ],
  proposedItems: [
    {
      id: id(16),
      kind: 'product',
      name: 'Рынок-сыр',
      note: null,
      defaultUnit: 'kg',
      typicalQuantity: { milli: 500n, unit: 'kg' },
      barcodes: [],
      createdAt: at,
    },
  ],
  addedBarcodes: [{ barcode: '4850001234567', itemId: id(8), addedAt: at }],
  storeMemory: [
    {
      tin: '01282006',
      kind: 'sku',
      key: '1163909',
      itemId: id(8),
      price: money(37_000n, 'AMD'),
      writtenAt: at,
    },
  ],
  feedback: [
    {
      number: 41,
      kind: 'bug',
      text: 'Не открывается «Деньги»',
      locale: 'ru',
      pageBuild: 'v0.1.3-20-gd90f9cee',
      apiBuild: 'v0.1.3-20-gd90f9cee',
      route: 'money',
      platform: 'ios 18 app',
      errorCode: 'error.internal',
      fromError: true,
      thread: null,
      inReplyTo: null,
      createdAt: at,
      replies: [{ number: 7, text: 'Починили', delivered: 'sent', createdAt: at }],
      pictures: [
        {
          position: 1,
          source: 'phone',
          width: 1179,
          height: 2556,
          bytes: 412_000,
          createdAt: at,
          sentAt: at,
        },
      ],
    },
    {
      number: 42,
      kind: 'bug',
      text: 'Спасибо',
      locale: 'ru',
      pageBuild: null,
      apiBuild: 'v0.1.3-21-g0a1b2c3d',
      route: null,
      platform: null,
      errorCode: null,
      fromError: false,
      thread: 41,
      inReplyTo: 7,
      createdAt: at,
      replies: [],
      pictures: [],
    },
  ],
  catalogue: {
    items: [{ id: id(8), kind: 'product', name: 'Молоко Ашхар 1 л' }],
    places: [{ id: id(5), kind: 'store', name: 'Ереван Сити', country: 'AM', city: 'Гюмри' }],
  },
}

const wire = z.encode(exportFileCodec, file)

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
}

describe('exportFileCodec', () => {
  it('writes money, quantity and rates as the wire does — decimal strings beside their unit', () => {
    expect(wire.exchanges[0]?.received).toEqual({ amount: '47000.00', currency: 'AMD' })
    expect(wire.expenses[0]?.quantity).toEqual({ value: '0.900', unit: 'l' })
    expect(wire.trips[0]?.rate?.rate).toBe('4.812345')
    expect(wire.trips[0]?.ratePrevious).toEqual({
      rate: '4.700000',
      asOf: '2026-09-20T10:00:00.000Z',
    })
    expect(wire.trips[0]?.receipt).toEqual({ amount: '12400.00', currency: 'AMD' })
    expect(wire.format).toBe('molvia-export')
    expect(wire.version).toBe(17)
    expect(wire.account.consentedAt).toBe('2026-09-20T10:00:00.000Z')
    expect(wire.account.analyticsOnAt).toBe('2026-09-20T10:00:00.000Z')
    expect(wire.receipts[0]?.lines[0]?.quantity).toEqual({ value: '2.000', unit: 'piece' })
    expect(wire.feedback[1]).toMatchObject({ thread: 41, inReplyTo: 7, replies: [] })
    expect(wire.budgetPlans[0]?.plan).toEqual({
      kind: 'amount',
      amount: { amount: '250000.00', currency: 'AMD' },
    })
  })

  it('reads its own file back into the same values', () => {
    expect(exportFileCodec.parse(JSON.parse(JSON.stringify(wire)))).toEqual(file)
  })

  it('names no secret: no token, no hash, no login code anywhere in the file', () => {
    expect(keysOf(wire).filter((key) => /token|hash|secret|^code$/i.test(key))).toEqual([])
  })

  it('carries a receipt’s lines, never the bytes of its photo or of its cut-out lines (MOL-125)', () => {
    expect(keysOf(wire).filter((key) => /photo|image/i.test(key))).toEqual([])
  })

  it('names the person once, in the account — no row repeats whose it is', () => {
    expect(keysOf(wire).filter((key) => key === 'actorId' || key === 'createdBy')).toEqual([])
  })

  it('refuses a field it does not know, so a new column cannot slip in unnamed', () => {
    const extra = { ...wire, spendings: [{ ...wire.spendings[0], tokenHash: 'x' }] }
    expect(exportFileCodec.safeParse(extra).success).toBe(false)
  })

  it('keeps what a stored row predates: a withdrawn event type, a rate outside today’s band', () => {
    const odd = {
      ...file,
      events: [
        { id: '1', occurredAt: at, type: 'catalogue_viewed', payload: { subject: 'venue' } },
      ],
      monthRates: [{ month: '2026-01', rate: { ...rate, scaled: 1n } }],
    }
    expect(z.encode(exportFileCodec, odd).monthRates[0]?.rate.rate).toBe('0.000001')
  })

  it('refuses a version it was not written for', () => {
    expect(exportFileCodec.safeParse({ ...wire, version: 1 }).success).toBe(false)
  })
})

/** Every schema node that holds a number, wherever it sits in the file's JSON Schema. */
function numbersIn(
  node: unknown,
  path = '$',
): { path: string; maximum: unknown; fixed: unknown }[] {
  if (Array.isArray(node))
    return node.flatMap((inner, index) => numbersIn(inner, `${path}[${String(index)}]`))
  if (node === null || typeof node !== 'object') return []
  const own = node as Record<string, unknown>
  const here =
    own.type === 'number' || own.type === 'integer'
      ? [{ path, maximum: own.maximum, fixed: own.const }]
      : []
  return [
    ...here,
    ...Object.entries(own).flatMap(([key, inner]) => numbersIn(inner, `${path}.${key}`)),
  ]
}

describe('what the phone may rebuild', () => {
  it('holds no number a JSON parser could round: every one is a safe integer, the rest are strings', () => {
    const schema = z.toJSONSchema(exportFileCodec, { io: 'input', unrepresentable: 'any' })
    const unsafe = numbersIn(schema).filter(
      ({ maximum, fixed }) =>
        fixed === undefined && (typeof maximum !== 'number' || maximum > Number.MAX_SAFE_INTEGER),
    )
    expect(numbersIn(schema).length).toBeGreaterThan(0)
    expect(unsafe).toEqual([])
  })
})
