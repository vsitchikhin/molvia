import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import {
  DomainError,
  ERROR,
  MONEY_ACCOUNT_UNDO_MINUTES,
  moneyAccountSchema,
  nameIdentity,
} from '@molvia/model'
import type {
  AccountOperation,
  Currency,
  Money,
  MoneyAccount,
  MoneyAccountAmendBody,
  MoneyAccountBody,
  MoneyAccountCheck,
} from '@molvia/model'
import { moneyFrom, rateFrom } from './columns'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull, theRow } from './rows'
import { exchanges, incomes, moneyAccountChecks, moneyAccounts, spendings, trips } from './schema'
import { tripMoneyRows } from './trip-money'
import type { TripMoneyRow } from './trip-money'

/**
 * The owner's accounts (MOL-115) and everything an account is counted from: the operations of all
 * four kinds in one shape, the checks, the account of a trip. Every rule of writing is one's money's
 * rule — named by the device, a repeat is the same answer, another body under the name a conflict,
 * an amendment names its version, a removal is a mark offered back for ten minutes.
 */
export interface MoneyAccountRepository {
  /** The owner's accounts, live and removed from the choice; one marked for deletion is not here. */
  list(actorId: string): Promise<readonly MoneyAccount[]>

  /**
   * Every account an operation may still name: the list and the ones marked for deletion — a
   * spending queued offline is not lost to an account deleted on another phone meanwhile (Р-17).
   */
  known(actorId: string): Promise<readonly MoneyAccount[]>

  /**
   * «Добавить счёт». The same identifier and account again is a repeat (`created: false`); another
   * under that identifier, or someone else's, is `CONFLICT`; a name one of the owner's accounts
   * already goes by — live, removed or marked — is `MONEY_ACCOUNT_TAKEN` (Р-21).
   */
  add(
    actorId: string,
    input: MoneyAccountBody,
  ): Promise<{ account: MoneyAccount; created: boolean }>

  /**
   * The owner's account as `input` says, over `input.revision`. The currency of one with operations
   * does not move — `MONEY_ACCOUNT_CURRENCY_LOCKED`. Missing, marked or someone else's: `NOT_FOUND`.
   */
  amend(actorId: string, id: string, input: MoneyAccountAmendBody): Promise<MoneyAccount>

  /**
   * «Удалить»: an account without operations is marked, offered back for ten minutes and then
   * deleted; one with operations is taken out of the choice and keeps everything. Null when there
   * is no such account of the owner's — a repeat of either is the same answer again.
   */
  remove(actorId: string, id: string): Promise<'marked' | 'archived' | null>

  /** «Вернуть» a marked or a removed one; false when there is nothing of the owner's to bring back. */
  restore(actorId: string, id: string): Promise<boolean>

  /**
   * Marked accounts of everyone past their ten minutes, deleted for good. An operation that named
   * one meanwhile is left without an account, and so lands in «не попали» — not lost (Р-17).
   */
  purgeStale(): Promise<void>

  /**
   * Every live operation of the owner, as accounts see it: spendings, incomes, both halves of every
   * exchange, and every trip — open ones too, the money is already gone — with what its priced
   * purchases came to per currency.
   */
  operations(actorId: string): Promise<readonly AccountOperation[]>

  /**
   * The latest check of every account of the owner, by account — or, `matched`, the latest one that
   * found no difference: only such a check is where the next one starts looking (owner's decision
   * В-4 of the review, adversarial Д7). One with a difference is remembered and shown, and what it
   * named stays in view until a check comes out even.
   */
  lastChecks(actorId: string, matched: boolean): Promise<ReadonlyMap<string, MoneyAccountCheck>>

  /** The latest check of one account that found no difference, but `except` — the one counted again. */
  lastMatched(
    actorId: string,
    accountId: string,
    except?: string,
  ): Promise<MoneyAccountCheck | null>

  /**
   * «Сверить»: written, or counted again under the same name — on the day it was first written. The
   * same name with another account or another fact is `CONFLICT` — another fact is another check.
   */
  saveCheck(
    actorId: string,
    check: Omit<MoneyAccountCheck, 'createdAt'>,
  ): Promise<MoneyAccountCheck>

  /**
   * «Списано» of a trip taken off, the account kept: its money changed, and the figure was what left
   * the account for the trip as it was (Р-32, adversarial Ж2). Nothing when there was none.
   */
  dropTripDebited(tripId: string): Promise<void>

  /** The account a trip was paid from and «списано»; false for a trip that is not the owner's. */
  setTripPayment(
    actorId: string,
    tripId: string,
    accountId: string | null,
    debited: Money | null,
  ): Promise<boolean>
}

type Row = typeof moneyAccounts.$inferSelect

/** One owner's names are decided one at a time: a check and its write are one step (MOL-73, Д7). */
function lockOwner(actorId: string) {
  return sql`select pg_advisory_xact_lock(hashtext('money_accounts'), hashtext(${actorId}))`
}

function undoFrom() {
  return sql`clock_timestamp() - make_interval(mins => ${MONEY_ACCOUNT_UNDO_MINUTES})`
}

function toAccount(row: Row): MoneyAccount {
  return moneyAccountSchema.parse({
    id: row.id,
    actorId: row.actorId,
    name: row.name,
    currency: row.currency,
    savings: row.savings,
    start: { minor: row.startMinor, currency: row.currency },
    startOn: row.startOn,
    revision: row.revision,
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  })
}

function columnsOf(input: Omit<MoneyAccountBody, 'id'>) {
  return {
    name: input.name,
    currency: input.currency,
    savings: input.savings,
    startMinor: input.start.minor,
    startOn: input.startOn,
  }
}

function says(row: Row, input: Omit<MoneyAccountBody, 'id'>): boolean {
  const columns = columnsOf(input)
  return (Object.keys(columns) as (keyof typeof columns)[]).every(
    (column) => row[column] === columns[column],
  )
}

/** Whether another account of the owner's that still exists goes by this name, in any case. */
function nameTaken(owned: readonly Row[], name: string, except?: string): boolean {
  const identity = nameIdentity(name)
  return owned.some((row) => row.id !== except && nameIdentity(row.name) === identity)
}

/**
 * Every operation that names an account `which` picks left without it, «списано» too, and the moment said: it is
 * new to every check after this (Р-17, Д1б). Before an account is deleted for good, or its key holds.
 */
async function unlink(tx: Conn, which: SQL | undefined): Promise<void> {
  const ids = sql`(select ${moneyAccounts.id} from ${moneyAccounts} where ${which})`
  const now = sql`clock_timestamp()`
  const unpaid = { accountId: null, debitedMinor: null, debitedCurrency: null, accountSetAt: now }
  await tx
    .update(spendings)
    .set(unpaid)
    .where(sql`${spendings.accountId} in ${ids}`)
  await tx
    .update(trips)
    .set(unpaid)
    .where(sql`${trips.accountId} in ${ids}`)
  await tx
    .update(incomes)
    .set({ accountId: null, accountSetAt: now })
    .where(sql`${incomes.accountId} in ${ids}`)
  await tx
    .update(exchanges)
    .set({ givenAccountId: null, accountSetAt: now })
    .where(sql`${exchanges.givenAccountId} in ${ids}`)
  await tx
    .update(exchanges)
    .set({ receivedAccountId: null, accountSetAt: now })
    .where(sql`${exchanges.receivedAccountId} in ${ids}`)
}

const NO_DETAILS = {
  categoryId: null,
  note: null,
  place: null,
  source: null,
  counterpart: null,
  items: null,
} as const

interface TripRow extends Record<string, unknown> {
  id: string
  place_name: string
  currency: Currency
  started_at: Date | string
  started_on: string
  finished_at: Date | string | null
  seen_at: Date | string
  account_id: string | null
  debited_minor: string | bigint | null
  debited_currency: Currency | null
  items: string | number
  unpriced: string | number
}

interface CheckRow extends Record<string, unknown> {
  id: string
  account_id: string
  checked_on: string
  fact_minor: string | bigint
  counted_minor: string | bigint
  currency: Currency
  created_at: Date | string
}

/** The latest of the moments that are known. */
function latest(...moments: (Date | null)[]): Date {
  return new Date(Math.max(...moments.map((moment) => moment?.getTime() ?? 0)))
}

function toCheck(row: CheckRow): MoneyAccountCheck {
  return {
    id: row.id,
    accountId: row.account_id,
    checkedOn: row.checked_on,
    fact: { minor: BigInt(row.fact_minor), currency: row.currency },
    counted: { minor: BigInt(row.counted_minor), currency: row.currency },
    createdAt: new Date(row.created_at),
  }
}

export function createMoneyAccountRepository(db: Conn): MoneyAccountRepository {
  async function owned(actorId: string, conn: Pick<Conn, 'select'> = db): Promise<Row[]> {
    return conn
      .select()
      .from(moneyAccounts)
      .where(eq(moneyAccounts.actorId, actorId))
      .orderBy(moneyAccounts.createdAt, moneyAccounts.id)
  }

  /** Whether an operation of any kind names the account — what decides «удалить» or «убрать». */
  async function hasOperations(conn: Conn, actorId: string, id: string): Promise<boolean> {
    const [row] = await conn.execute<{ used: boolean } & Record<string, unknown>>(sql`
      select exists (select 1 from spendings where actor_id = ${actorId} and account_id = ${id})
          or exists (select 1 from incomes where actor_id = ${actorId} and account_id = ${id})
          or exists (select 1 from exchanges where actor_id = ${actorId}
                       and (given_account_id = ${id} or received_account_id = ${id}))
          or exists (select 1 from trips where actor_id = ${actorId} and account_id = ${id})
          as used
    `)
    return row?.used === true
  }

  async function checksOf(actorId: string, matched: boolean, accountId?: string, except?: string) {
    const rows = await db.execute<CheckRow>(sql`
      select distinct on (c.account_id)
             c.id, c.account_id, c.checked_on::text as checked_on, c.fact_minor, c.counted_minor,
             a.currency, c.created_at
        from money_account_checks c
        join money_accounts a on a.id = c.account_id
       where c.actor_id = ${actorId}
         ${accountId === undefined ? sql`` : sql`and c.account_id = ${accountId}`}
         ${except === undefined ? sql`` : sql`and c.id <> ${except}`}
         ${matched ? sql`and c.fact_minor = c.counted_minor` : sql``}
       order by c.account_id, c.created_at desc, c.id desc
    `)
    return rows.map(toCheck)
  }

  return {
    async list(actorId) {
      return (await owned(actorId)).filter((row) => row.deletedAt === null).map(toAccount)
    },

    async known(actorId) {
      return (await owned(actorId)).map(toAccount)
    },

    async add(actorId, input) {
      return translateFailures(() =>
        db.transaction(async (tx) => {
          await tx.execute(lockOwner(actorId))
          // Past its ten minutes a deletion is final whether or not the timer has come round — and
          // final the way the timer makes it, what named it meanwhile left without it (Д5).
          const final = and(
            eq(moneyAccounts.id, input.id),
            eq(moneyAccounts.actorId, actorId),
            lte(moneyAccounts.deletedAt, undoFrom()),
          )
          await unlink(tx, final)
          await tx.delete(moneyAccounts).where(final)
          const rows = await owned(actorId, tx)
          const same = rows.find((row) => row.id === input.id)
          if (same) {
            if (same.deletedAt !== null || !says(same, input)) throw new DomainError(ERROR.CONFLICT)
            return { account: toAccount(same), created: false }
          }
          if (nameTaken(rows, input.name)) throw new DomainError(ERROR.MONEY_ACCOUNT_TAKEN)
          const [inserted] = await tx
            .insert(moneyAccounts)
            .values({ id: input.id, actorId, ...columnsOf(input) })
            .onConflictDoNothing({ target: moneyAccounts.id })
            .returning()
          // Taken by an identifier of someone else's: a device does not choose another's name.
          if (!inserted) throw new DomainError(ERROR.CONFLICT)
          return { account: toAccount(inserted), created: true }
        }),
      )
    },

    async amend(actorId, id, input) {
      const own = idOrNull(id)
      if (own === null) throw new DomainError(ERROR.NOT_FOUND)
      return translateFailures(() =>
        db.transaction(async (tx) => {
          await tx.execute(lockOwner(actorId))
          const rows = await owned(actorId, tx)
          const row = rows.find((candidate) => candidate.id === own && candidate.deletedAt === null)
          if (!row) throw new DomainError(ERROR.NOT_FOUND)
          if (says(row, input)) return toAccount(row)
          if (row.revision !== input.revision) throw new DomainError(ERROR.CONFLICT)
          if (nameTaken(rows, input.name, own)) throw new DomainError(ERROR.MONEY_ACCOUNT_TAKEN)
          if (input.currency !== row.currency && (await hasOperations(tx, actorId, own))) {
            throw new DomainError(ERROR.MONEY_ACCOUNT_CURRENCY_LOCKED)
          }
          const [amended] = await tx
            .update(moneyAccounts)
            .set({ ...columnsOf(input), revision: row.revision + 1 })
            .where(eq(moneyAccounts.id, own))
            .returning()
          return toAccount(theRow(amended, 'money_accounts'))
        }),
      )
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return null
      return db.transaction(async (tx) => {
        await tx.execute(lockOwner(actorId))
        const [row] = await tx
          .select()
          .from(moneyAccounts)
          .where(and(eq(moneyAccounts.id, own), eq(moneyAccounts.actorId, actorId)))
        if (!row) return null
        if (row.deletedAt !== null) return 'marked'
        if (row.archivedAt !== null) return 'archived'
        const used = await hasOperations(tx, actorId, own)
        await tx
          .update(moneyAccounts)
          .set(
            used ? { archivedAt: sql`clock_timestamp()` } : { deletedAt: sql`clock_timestamp()` },
          )
          .where(eq(moneyAccounts.id, own))
        return used ? 'archived' : 'marked'
      })
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      const restored = await db
        .update(moneyAccounts)
        .set({ deletedAt: null, archivedAt: null })
        .where(
          and(
            eq(moneyAccounts.id, own),
            eq(moneyAccounts.actorId, actorId),
            // Past its time a deletion is final even before the timer comes round.
            or(isNull(moneyAccounts.deletedAt), gt(moneyAccounts.deletedAt, undoFrom())),
          ),
        )
        .returning({ id: moneyAccounts.id })
      return restored.length > 0
    },

    async purgeStale() {
      await db.transaction(async (tx) => {
        const stale = and(
          isNotNull(moneyAccounts.deletedAt),
          lte(moneyAccounts.deletedAt, undoFrom()),
        )
        await unlink(tx, stale)
        await tx.delete(moneyAccounts).where(stale)
      })
    },

    async operations(actorId) {
      const [spent, received, exchanged, tripRows, tripSums] = await Promise.all([
        db
          .select()
          .from(spendings)
          .where(and(eq(spendings.actorId, actorId), isNull(spendings.deletedAt))),
        db
          .select()
          .from(incomes)
          .where(and(eq(incomes.actorId, actorId), isNull(incomes.deletedAt))),
        db
          .select()
          .from(exchanges)
          .where(and(eq(exchanges.actorId, actorId), isNull(exchanges.deletedAt))),
        db.execute<TripRow>(sql`
          select t.id, p.name as place_name, t.currency, t.started_at,
                 -- The phone's side of the start where the server's is later: a trip begun
                 -- offline in the evening and delivered after midnight (review Р2-3, В-6).
                 -- Unless it is more than a day before the server's start: an evening offline is
                 -- hours, and a clock days behind is a wrong clock, not a shelf (Ж1).
                 -- The phone's day of «Начать» where it named one (MOL-121) — held by the same
                 -- measure: a day more than one before the server's is a wrong clock. A trip
                 -- recorded from a receipt (MOL-126) is dated by the receipt's day, which the
                 -- server checked when it wrote it: a week-old receipt is a week-old purchase.
                 to_char(case when t.started_on >= (t.started_at at time zone 'Asia/Yerevan')::date - 1
                                or exists (select 1 from receipts r where r.trip_id = t.id)
                              then t.started_on
                              else (case when t.finished_on_device_at >= t.started_at - interval '1 day'
                                         then least(t.started_at, t.finished_on_device_at)
                                         else t.started_at end at time zone 'Asia/Yerevan')::date
                         end,
                         'YYYY-MM-DD') as started_on,
                 coalesce(t.finished_on_device_at, t.finished_at) as finished_at,
                 greatest(t.started_at, t.finished_at, t.account_set_at, t.receipt_set_at,
                          (select max(e.created_at) from expenses e where e.trip_id = t.id))
                   as seen_at,
                 t.account_id, t.debited_minor, t.debited_currency,
                 (select count(*) from expenses e where e.trip_id = t.id) as items,
                 -- A receipt's sum is the trip's money whole (MOL-78): nothing is missing from it.
                 case when t.receipt_minor is not null then 0
                      else (select count(*) from expenses e
                             where e.trip_id = t.id and e.amount_minor is null)
                 end as unpriced
            from trips t
            join places p on p.id = t.place_id
           where t.actor_id = ${actorId} and t.deleted_at is null
        `),
        db.execute<TripMoneyRow>(sql`
          select m.trip_id, m.currency, m.minor
            from (${tripMoneyRows(sql`t.actor_id = ${actorId} and t.deleted_at is null`)}) m
           order by m.trip_id, m.currency
        `),
      ])

      const operations: AccountOperation[] = []
      for (const row of spent) {
        operations.push({
          kind: 'spending',
          id: row.id,
          side: null,
          day: row.spentOn,
          at: row.createdAt,
          seenAt: latest(row.createdAt, row.amendedAt, row.accountSetAt),
          currency: row.currency,
          accountId: row.accountId,
          amounts: [{ minor: -row.amountMinor, currency: row.currency }],
          debited: moneyFrom(row.debitedMinor, row.debitedCurrency),
          rate: rateFrom(row),
          unpriced: 0,
          revision: row.revision,
          details: {
            ...NO_DETAILS,
            categoryId: row.categoryId,
            note: row.note,
            place: row.place,
          },
        })
      }
      for (const row of received) {
        operations.push({
          kind: 'income',
          id: row.id,
          side: null,
          day: row.receivedOn,
          at: row.createdAt,
          seenAt: latest(row.createdAt, row.amendedAt, row.accountSetAt),
          currency: row.currency,
          accountId: row.accountId,
          amounts: [{ minor: row.amountMinor, currency: row.currency }],
          debited: null,
          rate: null,
          unpriced: 0,
          revision: row.revision,
          details: { ...NO_DETAILS, note: row.note, source: row.source },
        })
      }
      for (const row of exchanged) {
        const given = { minor: -row.givenMinor, currency: row.givenCurrency }
        const got = { minor: row.receivedMinor, currency: row.receivedCurrency }
        const half = {
          kind: 'exchange' as const,
          id: row.id,
          day: row.exchangedOn,
          at: row.createdAt,
          seenAt: latest(row.createdAt, row.amendedAt, row.accountSetAt),
        }
        const common = { debited: null, rate: null, unpriced: 0, revision: row.revision }
        operations.push({
          ...half,
          ...common,
          side: 'given',
          currency: row.givenCurrency,
          accountId: row.givenAccountId,
          amounts: [given],
          details: {
            ...NO_DETAILS,
            note: row.note,
            counterpart: { accountId: row.receivedAccountId, amount: got },
          },
        })
        operations.push({
          ...half,
          ...common,
          side: 'received',
          currency: row.receivedCurrency,
          accountId: row.receivedAccountId,
          amounts: [got],
          details: {
            ...NO_DETAILS,
            note: row.note,
            counterpart: { accountId: row.givenAccountId, amount: given },
          },
        })
      }
      const sums = new Map<string, Money[]>()
      for (const row of tripSums) {
        const list = sums.get(row.trip_id) ?? []
        list.push({ minor: -BigInt(row.minor), currency: row.currency })
        sums.set(row.trip_id, list)
      }
      for (const row of tripRows) {
        operations.push({
          kind: 'trip',
          id: row.id,
          side: null,
          // The day it started: the money left at the shelf, and a trip left open for days, or
          // finished after midnight, is not taken from a start that already counted it (Д4).
          day: row.started_on,
          at: new Date(row.finished_at ?? row.started_at),
          seenAt: new Date(row.seen_at),
          currency: row.currency,
          accountId: row.account_id,
          amounts: sums.get(row.id) ?? [],
          debited:
            row.debited_minor === null || row.debited_currency === null
              ? null
              : { minor: BigInt(row.debited_minor), currency: row.debited_currency },
          rate: null,
          unpriced: Number(row.unpriced),
          revision: null,
          details: { ...NO_DETAILS, place: row.place_name, items: Number(row.items) },
        })
      }
      return operations
    },

    async lastChecks(actorId, matched) {
      const checks = await checksOf(actorId, matched)
      return new Map(checks.map((check) => [check.accountId, check]))
    },

    async lastMatched(actorId, accountId, except) {
      const [check] = await checksOf(actorId, true, accountId, except)
      return check ?? null
    },

    async saveCheck(actorId, check) {
      return translateFailures(async () => {
        const values = {
          accountId: check.accountId,
          checkedOn: check.checkedOn,
          factMinor: check.fact.minor,
          countedMinor: check.counted.minor,
        }
        const [inserted] = await db
          .insert(moneyAccountChecks)
          .values({ id: check.id, actorId, ...values })
          .onConflictDoNothing({ target: moneyAccountChecks.id })
          .returning()
        const row =
          inserted ??
          (
            await db
              .update(moneyAccountChecks)
              // The day stays the first one's (MOL-121, adversarial round 2 Р): «Записать разницу»
              // sends the same check again once its correction lands — after midnight, perhaps —
              // and the check was made on the day it was made, beside that correction.
              .set({ countedMinor: values.countedMinor })
              .where(
                and(
                  eq(moneyAccountChecks.id, check.id),
                  eq(moneyAccountChecks.actorId, actorId),
                  eq(moneyAccountChecks.accountId, check.accountId),
                  eq(moneyAccountChecks.factMinor, check.fact.minor),
                ),
              )
              .returning()
          )[0]
        if (!row) throw new DomainError(ERROR.CONFLICT)
        return {
          id: row.id,
          accountId: row.accountId,
          checkedOn: row.checkedOn,
          fact: { minor: row.factMinor, currency: check.fact.currency },
          counted: { minor: row.countedMinor, currency: check.counted.currency },
          createdAt: row.createdAt,
        }
      })
    },

    async dropTripDebited(tripId) {
      await db
        .update(trips)
        .set({ debitedMinor: null, debitedCurrency: null, accountSetAt: sql`clock_timestamp()` })
        .where(and(eq(trips.id, tripId), isNotNull(trips.debitedMinor)))
    },

    async setTripPayment(actorId, tripId, accountId, debited) {
      const own = idOrNull(tripId)
      if (own === null) return false
      return translateFailures(async () => {
        const updated = await db
          .update(trips)
          .set({
            accountId,
            debitedMinor: debited?.minor ?? null,
            debitedCurrency: debited?.currency ?? null,
            // A repeat from the queue moves nothing; a change is new to every later check (Д1б).
            accountSetAt: sql`case when ${trips.accountId} is not distinct from ${accountId}::uuid
              and ${trips.debitedMinor} is not distinct from ${debited?.minor ?? null}::bigint
              and ${trips.debitedCurrency} is not distinct from ${debited?.currency ?? null}::char(3)
              then ${trips.accountSetAt} else clock_timestamp() end`,
          })
          .where(and(eq(trips.id, own), eq(trips.actorId, actorId), isNull(trips.deletedAt)))
          .returning({ id: trips.id })
        return updated.length > 0
      })
    },
  }
}
