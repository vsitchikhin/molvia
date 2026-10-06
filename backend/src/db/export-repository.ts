import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'
import type { Currency, ExportContent, Money } from '@molvia/model'
import type { Db } from './index'
import type { ErasedTable } from './erasure-repository'
import {
  actors,
  budgetPlans,
  events,
  exchangeRevisions,
  exchanges,
  expenses,
  feedback,
  feedbackPictures,
  feedbackReplies,
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
  receiptLines,
  storeMemory,
  receipts,
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
  feedback: 'feedback',
  expenses: 'expenses',
  trips: 'trips',
  exchanges: 'exchanges',
  incomes: 'incomes',
  spendings: 'spendings',
  receipts: 'receipts',
  spending_categories: 'spendingCategories',
  budget_plans: 'budgetPlans',
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
    | ErasedTable
    | 'exchange_revisions'
    | 'catalogue_merge_moves'
    | 'income_revisions'
    | 'feedback_replies'
    | 'feedback_pictures'
    | 'feedback_picture_files'
    | 'owner_notices'
    | 'items'
    | 'item_barcodes'
    | 'store_memory'
    | 'receipt_lines'
    | 'receipt_parts'
    | 'receipt_line_images',
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
      'reminders_off',
      'receipt_notices_off',
      'bot_blocked_at',
      'consent_version',
      'consented_at',
      'analytics_off_at',
      'analytics_on_at',
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
  receipts: {
    exported: [
      'id',
      'status',
      'failure',
      'parts',
      'country',
      'language',
      'currency',
      'captured_at',
      'created_at',
      'queued_at',
      'reading_at',
      'read_at',
      'attempts',
      'reader_version',
      'layout',
      'tin',
      'printed_on',
      'printed_time',
      'receipt_no',
      'total_minor',
      'balanced',
      'city',
      'recorded_at',
      'heard',
      'heard_at',
      'trip_id',
      'deleted_at',
    ],
    omitted: { actor_id: OWNER },
  },
  // Read with their receipt, as an exchange's earlier versions are.
  receipt_lines: {
    exported: [
      'position',
      'printed',
      'hs',
      'sku',
      'qty_milli',
      'qty_unit',
      'price_minor',
      'sum_minor',
      'discount_minor',
      'settled',
      'item_id',
      'match',
      'translation',
      'expense_id',
    ],
    omitted: { receipt_id: 'the receipt it is nested in' },
  },
  // Taken by erasure with their receipt; never in the file — bytes of a picture, kept days (В-3).
  receipt_parts: {
    exported: [],
    omitted: {
      receipt_id: 'the receipt it is a part of',
      position: 'a part of a photo that is not in the file',
      photo: 'the photo itself: deleted once the receipt is recorded, never copied out',
      width: 'a measure of the photo that is not in the file',
      height: 'a measure of the photo that is not in the file',
      created_at: 'when a photo that is not in the file arrived',
    },
  },
  receipt_line_images: {
    exported: [],
    omitted: {
      receipt_id: 'the receipt it was cut from',
      position: 'the line it was cut from, which is in the file',
      piece: 'a row of a picture that is not in the file',
      image: 'a line cut out of the photo for the reader’s training (MOL-169), kept 28 days',
      read_text: 'the reader’s text of that row, which the line in the file already says',
      confirmed_text: 'the line as recorded, which the purchases already say',
      confirmed_at: 'when the receipt was recorded, which the receipt in the file says',
      created_at: 'when the row was cut, which the receipt’s reading says',
    },
  },
  spending_categories: {
    exported: ['id', 'preset', 'name', 'colour', 'archived_at', 'created_at'],
    omitted: { actor_id: OWNER },
  },
  money_month_rates: {
    exported: ['month', 'base', 'quote', 'scaled', 'source', 'as_of'],
    omitted: { actor_id: OWNER },
  },
  feedback: {
    exported: [
      'id',
      'kind',
      'text',
      'locale',
      'page_build',
      'api_build',
      'route',
      'platform',
      'error_code',
      'from_error',
      'thread_id',
      'in_reply_to',
      'created_at',
    ],
    omitted: {
      actor_id: OWNER,
      client_key: 'the phone’s key against sending one message twice, not what was said',
      head: 'said by `thread`: a first message has none',
      thread_head: 'said by `thread`: the key that holds a continuation to its first message',
      thread_key:
        'said by `thread`: the key that holds a continuation to a reply of its own thread',
      pictures: 'said by `pictures`: one line for each',
    },
  },
  feedback_replies: {
    exported: ['id', 'text', 'delivered', 'created_at'],
    omitted: {
      feedback_id: 'said by where the reply sits: under the message it answers',
      actor_id: OWNER,
      thread_id: 'said by where the reply sits: under a message of that thread',
      telegram_message_id:
        'which message the reply went out as in your chat, so your answer to it finds its thread; it means nothing outside that chat',
    },
  },
  // What is left of a picture once it reached the owner (MOL-167, В-1): never the picture itself.
  feedback_pictures: {
    exported: ['position', 'source', 'width', 'height', 'bytes', 'created_at', 'sent_at'],
    omitted: {
      feedback_id: 'said by where the picture sits: under the message it went with',
      fingerprint:
        'a checksum of the picture, so one sent twice is written once; it shows nothing of the picture',
    },
  },
  // The picture itself, while it waits for the owner's bot (MOL-167, В-1): never in the copy.
  feedback_picture_files: {
    exported: [],
    omitted: {
      feedback_id: 'said by the line of the picture in `pictures`',
      position: 'said by the line of the picture in `pictures`',
      image:
        'the picture is kept only until it reaches the developer’s Telegram, then erased; your own file is in your gallery',
      telegram_file_id:
        'Telegram’s name for the photo you sent the bot, kept until the developer has it; the photo is in your chat',
      created_at: 'when the picture came: said by its line in `pictures`',
    },
  },
  // The owner's notice of a message (MOL-148) goes with the message, so it is the person's too — and
  // all it holds of them is the message itself, in `feedback` word for word.
  owner_notices: {
    exported: [],
    omitted: {
      id: 'the owner’s channel’s own number, not yours',
      kind: 'a message or its continuation: said by the message in `feedback`',
      payload: 'the message itself, already in `feedback` word for word',
      feedback_id: 'said by the message it is about',
      created_at: 'when the message was written: in `feedback`',
      handed_at: 'when the owner’s bot took the notice — about the owner’s channel, not you',
      sent_at: 'when the owner’s bot said it went — about the owner’s channel, not you',
      tries: 'how many times the owner’s bot took it — about the owner’s channel, not you',
    },
  },
  budget_plans: {
    exported: ['category_id', 'from_month', 'amount_minor', 'currency', 'percent', 'updated_at'],
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
      'created_on',
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
      merged_into: 'the catalogue’s own merge of twins (MOL-106), not anything the person entered',
    },
  },
  // Read twice: the codes of the items the person added, whoever wrote them, and every code the
  // person wrote, to whichever item (MOL-100) — the second is theirs, as an item's author is.
  item_barcodes: { exported: ['code', 'item_id', 'added_at'], omitted: { added_by: OWNER } },
  // The journal of the merge of twins (MOL-106): a remembered pick that moved, kept only so that
  // `make unmerge` can move it back — the pick itself is in `searchPicks`.
  catalogue_merge_moves: {
    exported: [],
    omitted: {
      merge_id: 'a number of the catalogue’s journal, about an item, not the person',
      what: 'the kind of row the merge moved — the moved pick is in searchPicks',
      key: 'the query the moved pick was remembered under — the pick is in searchPicks',
      before: 'what the pick held before the merge, for the undo alone',
      actor_id: OWNER,
    },
  },
  store_memory: {
    exported: ['tin', 'kind', 'key', 'item_id', 'price_minor', 'price_currency', 'written_at'],
    omitted: { id: 'a key of the row, of no meaning to the person', actor_id: OWNER },
  },
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

function grouped<T, K>(rows: readonly T[], keyOf: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
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
          const feedbackRows = await tx
            .select()
            .from(feedback)
            .where(eq(feedback.actorId, actorId))
            .orderBy(asc(feedback.id))
          const replyRows = await tx
            .select({ reply: feedbackReplies })
            .from(feedbackReplies)
            .innerJoin(feedback, eq(feedback.id, feedbackReplies.feedbackId))
            .where(eq(feedback.actorId, actorId))
            .orderBy(asc(feedbackReplies.id))
          const pictureRows = await tx
            .select({
              feedbackId: feedbackPictures.feedbackId,
              position: feedbackPictures.position,
              source: feedbackPictures.source,
              width: feedbackPictures.width,
              height: feedbackPictures.height,
              bytes: feedbackPictures.bytes,
              createdAt: feedbackPictures.createdAt,
              sentAt: feedbackPictures.sentAt,
            })
            .from(feedbackPictures)
            .innerJoin(feedback, eq(feedback.id, feedbackPictures.feedbackId))
            .where(eq(feedback.actorId, actorId))
            .orderBy(asc(feedbackPictures.feedbackId), asc(feedbackPictures.position))
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
          const receiptRows = await tx
            .select()
            .from(receipts)
            .where(eq(receipts.actorId, actorId))
            .orderBy(asc(receipts.createdAt), asc(receipts.id))
          const receiptLineRows = await tx
            .select({ line: receiptLines })
            .from(receiptLines)
            .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
            .where(eq(receipts.actorId, actorId))
            .orderBy(asc(receiptLines.position))
          const linesOf = grouped(
            receiptLineRows.map((row) => row.line),
            (line) => line.receiptId,
          )
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
          const planRows = await tx
            .select()
            .from(budgetPlans)
            .where(eq(budgetPlans.actorId, actorId))
            .orderBy(asc(budgetPlans.fromMonth), asc(budgetPlans.categoryId))
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
          const memoryRows = await tx
            .select({
              tin: storeMemory.tin,
              kind: storeMemory.kind,
              key: storeMemory.key,
              itemId: storeMemory.itemId,
              priceMinor: storeMemory.priceMinor,
              priceCurrency: storeMemory.priceCurrency,
              writtenAt: storeMemory.writtenAt,
            })
            .from(storeMemory)
            .where(eq(storeMemory.actorId, actorId))
            .orderBy(asc(storeMemory.writtenAt), asc(storeMemory.id))
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
                inArray(
                  items.id,
                  tx
                    .select({ id: storeMemory.itemId })
                    .from(storeMemory)
                    .where(eq(storeMemory.actorId, actorId)),
                ),
                inArray(
                  items.id,
                  tx
                    .select({ id: receiptLines.itemId })
                    .from(receiptLines)
                    .innerJoin(receipts, eq(receipts.id, receiptLines.receiptId))
                    .where(eq(receipts.actorId, actorId)),
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
          const repliesOf = grouped(
            replyRows.map((row) => row.reply),
            (reply) => reply.feedbackId,
          )
          const picturesOf = grouped(pictureRows, (picture) => picture.feedbackId)

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
              remindersOff: account.remindersOff,
              receiptNoticesOff: account.receiptNoticesOff,
              botBlockedAt: account.botBlockedAt,
              consentVersion: account.consentVersion,
              consentedAt: account.consentedAt,
              analyticsOffAt: account.analyticsOffAt,
              analyticsOnAt: account.analyticsOnAt,
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
            receipts: receiptRows.map((row) => ({
              id: row.id,
              status: row.status,
              failure: row.failure,
              parts: row.parts,
              country: row.country,
              language: row.language,
              currency: row.currency,
              capturedAt: row.capturedAt,
              createdAt: row.createdAt,
              queuedAt: row.queuedAt,
              readingAt: row.readingAt,
              readAt: row.readAt,
              attempts: row.attempts,
              readerVersion: row.readerVersion,
              layout: row.layout,
              tin: row.tin,
              printedOn: row.printedOn,
              printedTime: row.printedTime,
              receiptNo: row.receiptNo,
              total: cash(row.totalMinor, row.currency),
              balanced: row.balanced,
              city: row.city,
              recordedAt: row.recordedAt,
              heard: row.heard,
              heardAt: row.heardAt,
              tripId: row.tripId,
              removedAt: row.deletedAt,
              lines: (linesOf.get(row.id) ?? []).map((line) => ({
                position: line.position,
                printed: line.printed,
                hs: line.hs,
                sku: line.sku,
                quantity:
                  line.qtyMilli === null || line.qtyUnit === null
                    ? null
                    : { milli: line.qtyMilli, unit: line.qtyUnit },
                price: cash(line.priceMinor, row.currency),
                sum: cash(line.sumMinor, row.currency),
                discount: cash(line.discountMinor, row.currency),
                settled: line.settled,
                itemId: line.itemId,
                match: line.match,
                translation: line.translation,
                expenseId: line.expenseId,
              })),
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
            budgetPlans: planRows.map((row) => ({
              categoryId: row.categoryId,
              from: row.fromMonth,
              plan:
                row.amountMinor !== null && row.currency !== null
                  ? {
                      kind: 'amount' as const,
                      amount: { minor: row.amountMinor, currency: row.currency },
                    }
                  : row.percent !== null
                    ? { kind: 'share' as const, percent: row.percent }
                    : null,
              updatedAt: row.updatedAt,
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
              createdOn: row.createdOn,
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
            storeMemory: memoryRows.map((row) => ({
              tin: row.tin,
              kind: row.kind,
              key: row.key,
              itemId: row.itemId,
              price: cash(row.priceMinor, row.priceCurrency),
              writtenAt: row.writtenAt,
            })),
            feedback: feedbackRows.map((row) => ({
              number: row.id,
              kind: row.kind,
              text: row.text,
              locale: row.locale,
              pageBuild: row.pageBuild,
              apiBuild: row.apiBuild,
              route: row.route,
              platform: row.platform,
              errorCode: row.errorCode,
              fromError: row.fromError,
              thread: row.threadId,
              inReplyTo: row.inReplyTo,
              createdAt: row.createdAt,
              replies: (repliesOf.get(row.id) ?? []).map((reply) => ({
                number: reply.id,
                text: reply.text,
                delivered: reply.delivered,
                createdAt: reply.createdAt,
              })),
              pictures: (picturesOf.get(row.id) ?? []).map((picture) => ({
                position: picture.position,
                source: picture.source,
                width: picture.width,
                height: picture.height,
                bytes: picture.bytes,
                createdAt: picture.createdAt,
                sentAt: picture.sentAt,
              })),
            })),
            catalogue: { items: namedItems, places: namedPlaces },
          }
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      )
    },
  }
}
