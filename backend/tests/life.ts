import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Db } from '@/db/index'
import {
  events,
  exchangeRevisions,
  itemBarcodes,
  exchanges,
  expenses,
  incomeRevisions,
  incomes,
  moneyAccountChecks,
  moneyAccounts,
  moneyMonthRates,
  budgetPlans,
  ratingReminders,
  receiptLineImages,
  receiptLines,
  receiptParts,
  receipts,
  searchPicks,
  spendingCategories,
  spendings,
  trips,
  verdicts,
} from '@/db/schema'
import { insertItem, insertLoginRequest, insertSession, insertTrip } from './fixtures'

/** Everything a person leaves behind, each table erasure removes touched at least once. */
export async function aLife(
  db: Db,
  actorId: string,
  telegramUserId: number,
  shared: { itemId: string; placeId: string },
): Promise<{
  ownItem: string
  exchangeId: string
  incomeId: string
  spendingId: string
  accountId: string
  receiptId: string
}> {
  const ownItem = await insertItem(db, {
    name: 'Рынок-сыр',
    searchKey: 'rinok sir',
    createdBy: actorId,
  })
  // A code written to an item someone else added (MOL-100): the catalogue keeps it, not its author.
  await db.insert(itemBarcodes).values({
    code: `48${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`,
    itemId: shared.itemId,
    addedBy: actorId,
  })
  const tripId = await insertTrip(db, { actorId, placeId: shared.placeId })
  await db.insert(expenses).values([
    { id: randomUUID(), tripId, itemId: shared.itemId },
    { id: randomUUID(), tripId, itemId: ownItem },
  ])
  await db.insert(verdicts).values([
    {
      id: randomUUID(),
      actorId,
      itemId: shared.itemId,
      itemKind: 'product',
      score: 5,
      review: 'Вкусно',
    },
    // Withdrawn: the gate keeps it, erasure must not.
    {
      id: randomUUID(),
      actorId,
      itemId: ownItem,
      itemKind: 'product',
      score: 1,
      ratedAt: new Date(Date.now() - 60_000),
      deletedAt: new Date(),
    },
  ])
  await db.insert(searchPicks).values({ actorId, queryKey: 'moloko', itemId: shared.itemId })
  // Where they stand on the ladder of reminders (MOL-101).
  await db.insert(ratingReminders).values({
    actorId,
    step: 2,
    remindedOn: '2026-07-17',
    remindedAt: new Date('2026-07-17T15:00:00Z'),
    windowFrom: '2026-07-13',
  })
  await db
    .insert(events)
    .values({ actorId, type: 'advice_viewed', payload: { subject: 'product' } })
  // Their own money (MOL-40): one exchange live, one removed but still offered back.
  const exchange = {
    actorId,
    givenMinor: 1_000_000n,
    givenCurrency: 'RUB',
    receivedMinor: 4_700_000n,
    receivedCurrency: 'AMD',
    exchangedOn: '2026-09-20',
  } as const
  const exchangeId = randomUUID()
  await db.insert(exchanges).values([
    { id: exchangeId, ...exchange, revision: 2 },
    { id: randomUUID(), ...exchange, deletedAt: new Date() },
  ])
  // An amendment's trace (MOL-42): it names the exchange, not the person, and goes with it.
  await db.insert(exchangeRevisions).values({ exchangeId, revision: 1, ...exchange })
  // Money that came in (MOL-66): one live income with a version before it, one removed.
  const income = {
    actorId,
    amountMinor: 9_961_500n,
    currency: 'RUB',
    receivedOn: '2026-09-15',
    source: 'salary',
  } as const
  const incomeId = randomUUID()
  await db.insert(incomes).values([
    { id: incomeId, ...income, revision: 2 },
    { id: randomUUID(), ...income, deletedAt: new Date() },
  ])
  await db.insert(incomeRevisions).values({ incomeId, revision: 1, ...income })
  // Spending outside trips (MOL-73): one's own category, a spending in it and a removed one, and a
  // closed month's frozen rate — all of it the person's, all of it goes.
  const categoryId = randomUUID()
  await db.insert(spendingCategories).values({ id: categoryId, actorId, name: 'Такси', colour: 0 })
  const spendingId = randomUUID()
  const spending = {
    actorId,
    spentOn: '2026-09-20',
    amountMinor: 500_000n,
    currency: 'AMD',
    categoryId,
    note: 'барбер',
  } as const
  await db.insert(spendings).values([
    { id: spendingId, ...spending },
    { id: randomUUID(), ...spending, deletedAt: new Date() },
  ])
  // Receipts photographed (MOL-125): one read and recorded — its photo, its lines, a line cut out —
  // and one that failed and was removed.
  const receiptId = randomUUID()
  const at = new Date('2026-09-30T11:03:50Z')
  await db.insert(receipts).values([
    {
      id: receiptId,
      actorId,
      status: 'recorded',
      parts: 1,
      country: 'AM',
      language: 'ru',
      currency: 'AMD',
      capturedAt: at,
      queuedAt: at,
      readingAt: at,
      readAt: at,
      attempts: 1,
      readerVersion: 'tesseract 5.5.0 · dc2c9f36ac9d',
      layout: 'card',
      tin: '01282006',
      printedOn: '2026-09-30',
      printedTime: '15:03',
      receiptNo: '21410811',
      totalMinor: 74_000n,
      balanced: true,
      recordedAt: at,
    },
    {
      id: randomUUID(),
      actorId,
      status: 'failed',
      failure: 'reshoot',
      parts: 1,
      country: 'AM',
      language: 'ru',
      currency: 'AMD',
      capturedAt: at,
      queuedAt: at,
      deletedAt: at,
    },
  ])
  await db.insert(receiptParts).values({
    receiptId,
    position: 1,
    photo: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    width: 700,
    height: 3_200,
  })
  await db.insert(receiptLines).values({
    receiptId,
    position: 0,
    printed: 'Կաթ «Իգիթ» 3.2% 1լ',
    hs: '0401',
    sku: '1163909',
    qtyMilli: 2_000n,
    qtyUnit: 'piece',
    priceMinor: 37_000n,
    sumMinor: 74_000n,
    discountMinor: 0n,
    settled: true,
  })
  await db.insert(receiptLineImages).values({
    receiptId,
    position: 0,
    piece: 1,
    image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    readText: '0401/1163909 2Հտ 740 370',
    confirmedText: '0401/1163909 2Հտ 740 370',
    confirmedAt: at,
  })
  await db.insert(moneyMonthRates).values({
    actorId,
    month: '2026-08',
    base: 'RUB',
    quote: 'AMD',
    scaled: 4_100_000n,
    source: 'personal',
    asOf: new Date('2026-08-30T20:00:00Z'),
  })
  // What the person plans a month at (MOL-117): one plan of the category, theirs too.
  await db.insert(budgetPlans).values({
    actorId,
    categoryId,
    fromMonth: '2026-09',
    amountMinor: 3_000_000n,
    currency: 'AMD',
  })
  // Where the money lay (MOL-115): an account, a check of it, and operations of every kind on it.
  const accountId = randomUUID()
  await db.insert(moneyAccounts).values({
    id: accountId,
    actorId,
    name: 'Наличные ֏',
    currency: 'AMD',
    startMinor: 24_153_000n,
    startOn: '2026-09-16',
  })
  await db.insert(moneyAccountChecks).values({
    id: randomUUID(),
    actorId,
    accountId,
    checkedOn: '2026-09-26',
    factMinor: 18_500_000n,
    countedMinor: 19_013_200n,
  })
  await db.update(spendings).set({ accountId }).where(eq(spendings.actorId, actorId))
  await db
    .update(exchanges)
    .set({ receivedAccountId: accountId })
    .where(eq(exchanges.actorId, actorId))
  await db.update(trips).set({ accountId }).where(eq(trips.actorId, actorId))
  await insertSession(db, { actorId })
  await insertLoginRequest(db, { telegramUserId }) // confirmed, not yet collected
  await insertLoginRequest(db, { telegramUserId, consumedAt: new Date() })
  return { ownItem, exchangeId, incomeId, spendingId, accountId, receiptId }
}
