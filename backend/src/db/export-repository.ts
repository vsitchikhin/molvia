import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Currency, ExportContent, Money } from '@molvia/model'
import type { Db } from './index'
import type { ErasedTable } from './erasure-repository'
import {
  actors,
  events,
  exchangeRevisions,
  exchanges,
  expenses,
  incomeRevisions,
  incomes,
  itemBarcodes,
  items,
  loginRequests,
  moneyAccountChecks,
  moneyAccounts,
  moneyMonthRates,
  places,
  ratingReminders,
  searchPicks,
  sessions,
  spendingCategories,
  spendings,
  trips,
  verdicts,
} from './schema'

/**
 * Where each table erasure removes lands in the file (MOL-93): a table added to erasure does not
 * compile until it has a section, and a test compares the counts of a dry run with the sections.
 */
export const EXPORT_SECTION_OF: Readonly<Record<ErasedTable, keyof ExportContent>> = {
  sessions: 'sessions',
  search_picks: 'searchPicks',
  rating_reminders: 'ratingReminders',
  verdicts: 'verdicts',
  events: 'events',
  expenses: 'expenses',
  trips: 'trips',
  exchanges: 'exchanges',
  incomes: 'incomes',
  spendings: 'spendings',
  spending_categories: 'spendingCategories',
  money_month_rates: 'monthRates',
  money_account_checks: 'accountChecks',
  money_accounts: 'moneyAccounts',
  login_requests: 'loginRequests',
  actors: 'account',
}

const OWNER = 'whose it is is said once, in `account`'

/**
 * Every column of every table a person's data is read from: in the file, or left out and why. A
 * test compares it with `information_schema`, so a column added later cannot miss the copy
 * silently — a table's key alone would not have caught a new note on an exchange.
 */
export const EXPORT_COLUMNS: Readonly<
  Record<
    ErasedTable | 'exchange_revisions' | 'income_revisions' | 'items' | 'item_barcodes',
    { readonly exported: readonly string[]; readonly omitted?: Readonly<Record<string, string>> }
  >
> = {
  actors: {
    exported: [
      'id',
      'telegram_user_id',
      'country',
      'city',
      'spend_currency',
      'income_currency',
      'income_currency_since',
      'rate_preference',
      'salary_shift_day',
      'shared_until',
      'created_at',
      'updated_at',
    ],
  },
  sessions: {
    exported: ['id', 'device_name', 'created_at', 'last_seen_at', 'expires_at'],
    omitted: { actor_id: OWNER, token_hash: 'the key to the account, not data about the person' },
  },
  login_requests: {
    exported: ['id', 'device_name', 'created_at', 'expires_at', 'consumed_at'],
    omitted: {
      telegram_user_id: OWNER,
      code: 'the one-use name a login is confirmed by',
      secret_hash: 'the key a login is collected with',
    },
  },
  trips: {
    exported: [
      'id',
      'place_id',
      'currency',
      'rate_base',
      'rate_quote',
      'rate_scaled',
      'rate_source',
      'rate_as_of',
      'rate_provider',
      'rate_jumped',
      'rate_previous_scaled',
      'rate_previous_as_of',
      'rate_manual_scaled',
      'rate_manual_as_of',
      'rate_choice',
      'started_at',
      'finished_at',
      'finished_on_device_at',
      'started_on',
      'finished_on',
      'account_id',
      'debited_minor',
      'debited_currency',
      'account_set_at',
      'receipt_minor',
      'receipt_currency',
      'receipt_set_at',
      'receipt_first_at',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  expenses: {
    exported: [
      'id',
      'trip_id',
      'item_id',
      'qty_milli',
      'qty_unit',
      'amount_minor',
      'amount_currency',
      'created_at',
    ],
  },
  verdicts: {
    exported: [
      'id',
      'item_id',
      'item_kind',
      'place_id',
      'score',
      'review',
      'rated_at',
      'updated_at',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  search_picks: {
    exported: ['query_key', 'item_id', 'picks', 'last_picked_at', 'admits'],
    omitted: { actor_id: OWNER },
  },
  rating_reminders: {
    exported: ['step', 'reminded_on', 'reminded_at', 'window_from'],
    omitted: { actor_id: OWNER },
  },
  events: {
    exported: ['id', 'occurred_at', 'type', 'payload'],
    omitted: { actor_id: OWNER },
  },
  exchanges: {
    exported: [
      'id',
      'given_minor',
      'given_currency',
      'received_minor',
      'received_currency',
      'exchanged_on',
      'held_before_minor',
      'note',
      'channel',
      'given_account_id',
      'received_account_id',
      'account_set_at',
      'revision',
      'created_at',
      'amended_at',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  exchange_revisions: {
    exported: [
      'exchange_id',
      'revision',
      'given_minor',
      'given_currency',
      'received_minor',
      'received_currency',
      'exchanged_on',
      'held_before_minor',
      'note',
      'channel',
      'replaced_at',
    ],
  },
  incomes: {
    exported: [
      'id',
      'amount_minor',
      'currency',
      'received_on',
      'held_before_minor',
      'source',
      'note',
      'account_id',
      'account_set_at',
      'revision',
      'created_at',
      'amended_at',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  income_revisions: {
    exported: [
      'income_id',
      'revision',
      'amount_minor',
      'currency',
      'received_on',
      'held_before_minor',
      'source',
      'note',
      'replaced_at',
    ],
  },
  spendings: {
    exported: [
      'id',
      'spent_on',
      'amount_minor',
      'currency',
      'category_id',
      'note',
      'place',
      'rate_base',
      'rate_quote',
      'rate_scaled',
      'rate_source',
      'rate_as_of',
      'account_id',
      'debited_minor',
      'debited_currency',
      'account_set_at',
      'revision',
      'created_at',
      'amended_at',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  spending_categories: {
    exported: ['id', 'preset', 'name', 'colour', 'archived_at', 'created_at'],
    omitted: { actor_id: OWNER },
  },
  money_month_rates: {
    exported: ['month', 'base', 'quote', 'scaled', 'source', 'as_of'],
    omitted: { actor_id: OWNER },
  },
  money_accounts: {
    exported: [
      'id',
      'name',
      'currency',
      'savings',
      'start_minor',
      'start_on',
      'revision',
      'created_at',
      'archived_at',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  money_account_checks: {
    exported: ['id', 'account_id', 'checked_on', 'fact_minor', 'counted_minor', 'created_at'],
    omitted: { actor_id: OWNER },
  },
  items: {
    exported: [
      'id',
      'kind',
      'name',
      'note',
      'default_unit',
      'typical_qty_milli',
      'typical_qty_unit',
      'created_at',
    ],
    omitted: {
      created_by: OWNER,
      search_key: 'made from the name, never typed',
      origin: "the catalogue's licence mark (MOL-162), not anything the person entered",
    },
  },
  // Read twice: the codes of the items the person added, whoever wrote them, and every code the
  // person wrote, to whichever item (MOL-100) — the second is theirs, as an item's author is.
  item_barcodes: { exported: ['code', 'item_id', 'added_at'], omitted: { added_by: OWNER } },
}

export interface ExportRepository {
  /**
   * Everything of one owner, as one snapshot (MOL-93): `repeatable read` and `read only`, so a
   * trip and its expenses are read at the same moment. `null` when there is no such owner — one
   * erased between the session check and this read.
   */
  exportOf(actorId: string, currentSessionId: string): Promise<ExportContent | null>
}

function cash(minor: bigint | null, currency: Currency | null): Money | null {
  return minor === null || currency === null ? null : { minor, currency }
}

function grouped<T>(rows: readonly T[], keyOf: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const group = groups.get(keyOf(row))
    if (group) group.push(row)
    else groups.set(keyOf(row), [row])
  }
  return groups
}

export function createExportRepository(db: Db): ExportRepository {
  return {
    exportOf(actorId, currentSessionId) {
      return db.transaction(
        async (tx) => {
          const [account] = await tx.select().from(actors).where(eq(actors.id, actorId))
          if (account === undefined) return null

          const ownTrips = tx.select({ id: trips.id }).from(trips).where(eq(trips.actorId, actorId))
          const tripRows = await tx
            .select()
            .from(trips)
            .where(eq(trips.actorId, actorId))
            .orderBy(asc(trips.startedAt), asc(trips.id))
          const expenseRows = await tx
            .select()
            .from(expenses)
            .where(inArray(expenses.tripId, ownTrips))
            .orderBy(asc(expenses.createdAt), asc(expenses.id))
          const verdictRows = await tx
            .select()
            .from(verdicts)
            .where(eq(verdicts.actorId, actorId))
            .orderBy(asc(verdicts.ratedAt), asc(verdicts.id))
          const pickRows = await tx
            .select()
            .from(searchPicks)
            .where(eq(searchPicks.actorId, actorId))
            .orderBy(asc(searchPicks.lastPickedAt), asc(searchPicks.queryKey))
          const ladderRows = await tx
            .select()
            .from(ratingReminders)
            .where(eq(ratingReminders.actorId, actorId))
          const eventRows = await tx
            .select()
            .from(events)
            .where(eq(events.actorId, actorId))
            .orderBy(asc(events.id))
          const exchangeRows = await tx
            .select()
            .from(exchanges)
            .where(eq(exchanges.actorId, actorId))
            .orderBy(asc(exchanges.exchangedOn), asc(exchanges.createdAt), asc(exchanges.id))
          const exchangeVersions = await tx
            .select()
            .from(exchangeRevisions)
            .innerJoin(exchanges, eq(exchanges.id, exchangeRevisions.exchangeId))
            .where(eq(exchanges.actorId, actorId))
            .orderBy(asc(exchangeRevisions.revision))
          const incomeRows = await tx
            .select()
            .from(incomes)
            .where(eq(incomes.actorId, actorId))
            .orderBy(asc(incomes.receivedOn), asc(incomes.createdAt), asc(incomes.id))
          const incomeVersions = await tx
            .select()
            .from(incomeRevisions)
            .innerJoin(incomes, eq(incomes.id, incomeRevisions.incomeId))
            .where(eq(incomes.actorId, actorId))
            .orderBy(asc(incomeRevisions.revision))
          const spendingRows = await tx
            .select()
            .from(spendings)
            .where(eq(spendings.actorId, actorId))
            .orderBy(asc(spendings.spentOn), asc(spendings.createdAt), asc(spendings.id))
          const categoryRows = await tx
            .select()
            .from(spendingCategories)
            .where(eq(spendingCategories.actorId, actorId))
            .orderBy(asc(spendingCategories.createdAt), asc(spendingCategories.id))
          const monthRateRows = await tx
            .select()
            .from(moneyMonthRates)
            .where(eq(moneyMonthRates.actorId, actorId))
            .orderBy(asc(moneyMonthRates.month), asc(moneyMonthRates.base))
          const accountRows = await tx
            .select()
            .from(moneyAccounts)
            .where(eq(moneyAccounts.actorId, actorId))
            .orderBy(asc(moneyAccounts.createdAt), asc(moneyAccounts.id))
          const checkRows = await tx
            .select({ check: moneyAccountChecks, currency: moneyAccounts.currency })
            .from(moneyAccountChecks)
            .innerJoin(moneyAccounts, eq(moneyAccounts.id, moneyAccountChecks.accountId))
            .where(eq(moneyAccountChecks.actorId, actorId))
            .orderBy(asc(moneyAccountChecks.createdAt), asc(moneyAccountChecks.id))
          const sessionRows = await tx
            .select()
            .from(sessions)
            .where(eq(sessions.actorId, actorId))
            .orderBy(asc(sessions.createdAt), asc(sessions.id))
          const loginRows = await tx
            .select()
            .from(loginRequests)
            .where(eq(loginRequests.telegramUserId, account.telegramUserId))
            .orderBy(asc(loginRequests.createdAt), asc(loginRequests.id))
          const proposedRows = await tx
            .select()
            .from(items)
            .where(eq(items.createdBy, actorId))
            .orderBy(asc(items.createdAt), asc(items.id))
          const barcodeRows = await tx
            .select({ code: itemBarcodes.code, itemId: itemBarcodes.itemId })
            .from(itemBarcodes)
            .innerJoin(items, eq(items.id, itemBarcodes.itemId))
            .where(eq(items.createdBy, actorId))
            .orderBy(asc(itemBarcodes.code))
          const addedCodeRows = await tx
            .select({
              barcode: itemBarcodes.code,
              itemId: itemBarcodes.itemId,
              addedAt: itemBarcodes.addedAt,
            })
            .from(itemBarcodes)
            .where(eq(itemBarcodes.addedBy, actorId))
            .orderBy(asc(itemBarcodes.addedAt), asc(itemBarcodes.code))
          const namedItems = await tx
            .select({ id: items.id, kind: items.kind, name: items.name })
            .from(items)
            .where(
              or(
                inArray(
                  items.id,
                  tx
                    .select({ id: expenses.itemId })
                    .from(expenses)
                    .where(inArray(expenses.tripId, ownTrips)),
                ),
                inArray(
                  items.id,
                  tx
                    .select({ id: verdicts.itemId })
                    .from(verdicts)
                    .where(eq(verdicts.actorId, actorId)),
                ),
                inArray(
                  items.id,
                  tx
                    .select({ id: searchPicks.itemId })
                    .from(searchPicks)
                    .where(eq(searchPicks.actorId, actorId)),
                ),
                inArray(
                  items.id,
                  tx
                    .select({ id: itemBarcodes.itemId })
                    .from(itemBarcodes)
                    .where(eq(itemBarcodes.addedBy, actorId)),
                ),
              ),
            )
            .orderBy(asc(items.name), asc(items.id))
          const namedPlaces = await tx
            .select({
              id: places.id,
              kind: places.kind,
              name: places.name,
              country: places.country,
              city: places.city,
            })
            .from(places)
            .where(
              or(
                inArray(
                  places.id,
                  tx.select({ id: trips.placeId }).from(trips).where(eq(trips.actorId, actorId)),
                ),
                inArray(
                  places.id,
                  tx
                    .select({ id: verdicts.placeId })
                    .from(verdicts)
                    .where(
                      and(eq(verdicts.actorId, actorId), sql`${verdicts.placeId} is not null`),
                    ),
                ),
              ),
            )
            .orderBy(asc(places.name), asc(places.id))

          const exchangeVersionsOf = grouped(
            exchangeVersions.map((row) => row.exchange_revisions),
            (version) => version.exchangeId,
          )
          const incomeVersionsOf = grouped(
            incomeVersions.map((row) => row.income_revisions),
            (version) => version.incomeId,
          )
          const barcodesOf = grouped(barcodeRows, (barcode) => barcode.itemId)

          return {
            account: {
              id: account.id,
              telegramUserId: account.telegramUserId,
              country: account.country,
              city: account.city,
              spendCurrency: account.spendCurrency,
              incomeCurrency: account.incomeCurrency,
              incomeCurrencySince: account.incomeCurrencySince,
              ratePreference: account.ratePreference,
              salaryShiftDay: account.salaryShiftDay,
              sharedUntil: account.sharedUntil,
              createdAt: account.createdAt,
              updatedAt: account.updatedAt,
            },
            sessions: sessionRows.map((row) => ({
              id: row.id,
              deviceName: row.deviceName,
              current: row.id === currentSessionId,
              createdAt: row.createdAt,
              lastSeenAt: row.lastSeenAt,
              expiresAt: row.expiresAt,
            })),
            loginRequests: loginRows.map((row) => ({
              id: row.id,
              deviceName: row.deviceName,
              createdAt: row.createdAt,
              expiresAt: row.expiresAt,
              consumedAt: row.consumedAt,
            })),
            trips: tripRows.map((row) => ({
              id: row.id,
              placeId: row.placeId,
              currency: row.currency,
              rate:
                row.rateBase === null ||
                row.rateQuote === null ||
                row.rateScaled === null ||
                row.rateSource === null ||
                row.rateAsOf === null
                  ? null
                  : {
                      base: row.rateBase,
                      quote: row.rateQuote,
                      scaled: row.rateScaled,
                      source: row.rateSource,
                      asOf: row.rateAsOf,
                    },
              rateProvider: row.rateProvider,
              rateJumped: row.rateJumped,
              ratePrevious:
                row.ratePreviousScaled === null || row.ratePreviousAsOf === null
                  ? null
                  : { scaled: row.ratePreviousScaled, asOf: row.ratePreviousAsOf },
              rateManual:
                row.rateManualScaled === null || row.rateManualAsOf === null
                  ? null
                  : { scaled: row.rateManualScaled, asOf: row.rateManualAsOf },
              rateChoice: row.rateChoice,
              startedAt: row.startedAt,
              finishedAt: row.finishedAt,
              finishedOnDeviceAt: row.finishedOnDeviceAt,
              startedOn: row.startedOn,
              finishedOn: row.finishedOn,
              accountId: row.accountId,
              debited: cash(row.debitedMinor, row.debitedCurrency),
              accountSetAt: row.accountSetAt,
              receipt: cash(row.receiptMinor, row.receiptCurrency),
              receiptSetAt: row.receiptSetAt,
              receiptFirstAt: row.receiptFirstAt,
              removedAt: row.deletedAt,
            })),
            expenses: expenseRows.map((row) => ({
              id: row.id,
              tripId: row.tripId,
              itemId: row.itemId,
              quantity:
                row.qtyMilli === null || row.qtyUnit === null
                  ? null
                  : { milli: row.qtyMilli, unit: row.qtyUnit },
              amount: cash(row.amountMinor, row.amountCurrency),
              createdAt: row.createdAt,
            })),
            verdicts: verdictRows.map((row) => ({
              id: row.id,
              itemId: row.itemId,
              itemKind: row.itemKind,
              placeId: row.placeId,
              score: row.score,
              review: row.review,
              ratedAt: row.ratedAt,
              updatedAt: row.updatedAt,
              withdrawnAt: row.deletedAt,
            })),
            searchPicks: pickRows.map((row) => ({
              queryKey: row.queryKey,
              itemId: row.itemId,
              picks: row.picks,
              lastPickedAt: row.lastPickedAt,
              admits: row.admits,
            })),
            ratingReminders: ladderRows.map((row) => ({
              step: row.step,
              remindedOn: row.remindedOn,
              remindedAt: row.remindedAt,
              windowFrom: row.windowFrom,
            })),
            events: eventRows.map((row) => ({
              id: row.id.toString(),
              occurredAt: row.occurredAt,
              type: row.type,
              payload: row.payload,
            })),
            exchanges: exchangeRows.map((row) => ({
              id: row.id,
              given: { minor: row.givenMinor, currency: row.givenCurrency },
              received: { minor: row.receivedMinor, currency: row.receivedCurrency },
              exchangedOn: row.exchangedOn,
              heldBefore: cash(row.heldBeforeMinor, row.receivedCurrency),
              note: row.note,
              channel: row.channel,
              givenAccountId: row.givenAccountId,
              receivedAccountId: row.receivedAccountId,
              accountSetAt: row.accountSetAt,
              revision: row.revision,
              createdAt: row.createdAt,
              amendedAt: row.amendedAt,
              removedAt: row.deletedAt,
              earlierVersions: (exchangeVersionsOf.get(row.id) ?? []).map((version) => ({
                revision: version.revision,
                given: { minor: version.givenMinor, currency: version.givenCurrency },
                received: { minor: version.receivedMinor, currency: version.receivedCurrency },
                exchangedOn: version.exchangedOn,
                heldBefore: cash(version.heldBeforeMinor, version.receivedCurrency),
                note: version.note,
                channel: version.channel,
                replacedAt: version.replacedAt,
              })),
            })),
            incomes: incomeRows.map((row) => ({
              id: row.id,
              amount: { minor: row.amountMinor, currency: row.currency },
              receivedOn: row.receivedOn,
              heldBefore: cash(row.heldBeforeMinor, row.currency),
              source: row.source,
              note: row.note,
              accountId: row.accountId,
              accountSetAt: row.accountSetAt,
              revision: row.revision,
              createdAt: row.createdAt,
              amendedAt: row.amendedAt,
              removedAt: row.deletedAt,
              earlierVersions: (incomeVersionsOf.get(row.id) ?? []).map((version) => ({
                revision: version.revision,
                amount: { minor: version.amountMinor, currency: version.currency },
                receivedOn: version.receivedOn,
                heldBefore: cash(version.heldBeforeMinor, version.currency),
                source: version.source,
                note: version.note,
                replacedAt: version.replacedAt,
              })),
            })),
            spendings: spendingRows.map((row) => ({
              id: row.id,
              spentOn: row.spentOn,
              amount: { minor: row.amountMinor, currency: row.currency },
              categoryId: row.categoryId,
              note: row.note,
              place: row.place,
              rate:
                row.rateBase === null ||
                row.rateQuote === null ||
                row.rateScaled === null ||
                row.rateSource === null ||
                row.rateAsOf === null
                  ? null
                  : {
                      base: row.rateBase,
                      quote: row.rateQuote,
                      scaled: row.rateScaled,
                      source: row.rateSource,
                      asOf: row.rateAsOf,
                    },
              accountId: row.accountId,
              debited: cash(row.debitedMinor, row.debitedCurrency),
              accountSetAt: row.accountSetAt,
              revision: row.revision,
              createdAt: row.createdAt,
              amendedAt: row.amendedAt,
              removedAt: row.deletedAt,
            })),
            spendingCategories: categoryRows.map((row) => ({
              id: row.id,
              preset: row.preset,
              name: row.name,
              colour: row.colour,
              archivedAt: row.archivedAt,
              createdAt: row.createdAt,
            })),
            monthRates: monthRateRows.map((row) => ({
              month: row.month,
              rate: {
                base: row.base,
                quote: row.quote,
                scaled: row.scaled,
                source: row.source,
                asOf: row.asOf,
              },
            })),
            moneyAccounts: accountRows.map((row) => ({
              id: row.id,
              name: row.name,
              currency: row.currency,
              savings: row.savings,
              start: { minor: row.startMinor, currency: row.currency },
              startOn: row.startOn,
              revision: row.revision,
              createdAt: row.createdAt,
              archivedAt: row.archivedAt,
              removedAt: row.deletedAt,
            })),
            accountChecks: checkRows.map(({ check, currency }) => ({
              id: check.id,
              accountId: check.accountId,
              checkedOn: check.checkedOn,
              fact: { minor: check.factMinor, currency },
              counted: { minor: check.countedMinor, currency },
              createdAt: check.createdAt,
            })),
            proposedItems: proposedRows.map((row) => ({
              id: row.id,
              kind: row.kind,
              name: row.name,
              note: row.note,
              defaultUnit: row.defaultUnit,
              typicalQuantity:
                row.typicalQtyMilli === null || row.typicalQtyUnit === null
                  ? null
                  : { milli: row.typicalQtyMilli, unit: row.typicalQtyUnit },
              barcodes: (barcodesOf.get(row.id) ?? []).map((barcode) => barcode.code),
              createdAt: row.createdAt,
            })),
            addedBarcodes: addedCodeRows,
            catalogue: { items: namedItems, places: namedPlaces },
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
    },
  }
}
