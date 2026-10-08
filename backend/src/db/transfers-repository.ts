import { randomUUID } from 'node:crypto'
import { and, eq, gt, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { DomainError, ERROR, TRANSFER_UNDO_MINUTES, transferSchema } from '@molvia/model'
import type { ExchangeRate, Transfer, TransferAmendBody, TransferBody } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { lockOwner } from './money-accounts-repository'
import { idOrNull, theRow } from './rows'
import { accountTransferRevisions, accountTransfers, moneyAccounts, spendings } from './schema'

/**
 * What the fee of a transfer is written as, beside its sum (MOL-253, Р-1): the owner's «Прочее» and
 * the rate of the transfer's day into the spending currency — the snapshot every spending keeps,
 * decided by the use case as a spending's is.
 */
export interface FeeSpending {
  readonly categoryId: string
  readonly rate: ExchangeRate | null
}

/**
 * The owner's transfers between their own accounts (MOL-253), each with its fee — a row of
 * `spendings` written, amended, removed and brought back with it, in one transaction, so «Траты» and
 * the journal of the account never tell two stories. Every rule of writing is an exchange's: the same
 * identifier with the same transfer is a repeat, with another `CONFLICT`; an amendment keeps the
 * version before it and names the one it was made over; a removal is a mark offered back for ten
 * minutes. The accounts are decided under the owner's lock, the one an account's removal takes, so a
 * transfer never lands on an account marked for deletion meanwhile — and the timer that deletes such
 * an account never meets one.
 */
export interface TransferRepository {
  /**
   * «Перевести». Both accounts must be the owner's, not marked for deletion, and of the money's
   * currency — `TRANSFER_ACCOUNT` otherwise. The same identifier and transfer again is a repeat
   * (`created: false`), whatever happened to the accounts since; anything else under it `CONFLICT`.
   */
  add(
    actorId: string,
    input: TransferBody,
    fee: FeeSpending | null,
  ): Promise<{ transfer: Transfer; created: boolean }>

  /**
   * The owner's transfer as `input` says, over `input.revision`, the version before it kept. Already
   * so — a repeat — it returns with `amended: false`. Missing, removed or someone else's: `NOT_FOUND`.
   */
  amend(
    actorId: string,
    id: string,
    input: TransferAmendBody,
    fee: FeeSpending | null,
  ): Promise<{ transfer: Transfer; amended: boolean }>

  /** The owner's live transfer, or null. */
  byId(actorId: string, id: string): Promise<Transfer | null>

  /** The owner's transfer and its fee, marked and gone from every reader; what was removed, or null. */
  remove(actorId: string, id: string): Promise<Transfer | null>

  /** «Вернуть»: the removed transfer and its fee, back; false once final or never the owner's. */
  restore(actorId: string, id: string): Promise<boolean>

  /** Removed transfers of the owner, deleted for good — all but `except`, the one being removed. */
  purgeRemoved(actorId: string, except?: string): Promise<void>

  /** Removed transfers of everyone, deleted for good once `TRANSFER_UNDO_MINUTES` have passed. */
  purgeStale(): Promise<void>
}

type Row = typeof accountTransfers.$inferSelect
type FeeRow = typeof spendings.$inferSelect

/** What a transfer says, in columns — what a repeat is compared by and an amendment writes. */
function columnsOf(input: Omit<TransferBody, 'id'>) {
  return {
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    amountMinor: input.amount.minor,
    currency: input.amount.currency,
    transferredOn: input.transferredOn,
    note: input.note ?? null,
  }
}

function says(row: Row, fee: FeeRow | undefined, input: Omit<TransferBody, 'id'>): boolean {
  const columns = columnsOf(input)
  return (
    (Object.keys(columns) as (keyof typeof columns)[]).every(
      (column) => row[column] === columns[column],
    ) && (fee?.amountMinor ?? null) === (input.fee?.minor ?? null)
  )
}

function undoFrom() {
  return sql`clock_timestamp() - make_interval(mins => ${TRANSFER_UNDO_MINUTES})`
}

function toTransfer(row: Row, fee: FeeRow | undefined): Transfer {
  return transferSchema.parse({
    id: row.id,
    actorId: row.actorId,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    amount: { minor: row.amountMinor, currency: row.currency },
    fee: fee ? { minor: fee.amountMinor, currency: fee.currency } : null,
    transferredOn: row.transferredOn,
    note: row.note,
    revision: row.revision,
    createdAt: row.createdAt,
    amendedAt: row.amendedAt,
  })
}

/** The fee's columns: a spending of the source, on the transfer's day, in its currency. */
function feeColumnsOf(input: Omit<TransferBody, 'id'>, fee: FeeSpending, minor: bigint) {
  return {
    spentOn: input.transferredOn,
    amountMinor: minor,
    currency: input.amount.currency,
    categoryId: fee.categoryId,
    accountId: input.fromAccountId,
    rateBase: fee.rate?.base ?? null,
    rateQuote: fee.rate?.quote ?? null,
    rateScaled: fee.rate?.scaled ?? null,
    rateSource: fee.rate?.source ?? null,
    rateAsOf: fee.rate?.asOf ?? null,
  }
}

export function createTransferRepository(db: Conn): TransferRepository {
  async function feeOf(conn: Pick<Conn, 'select'>, transferId: string) {
    const [fee] = await conn.select().from(spendings).where(eq(spendings.transferId, transferId))
    return fee
  }

  /** Both accounts are the owner's, not marked for deletion, and of the money's currency. */
  async function accountsHold(tx: Conn, actorId: string, input: Omit<TransferBody, 'id'>) {
    const found = await tx
      .select({ id: moneyAccounts.id })
      .from(moneyAccounts)
      .where(
        and(
          eq(moneyAccounts.actorId, actorId),
          inArray(moneyAccounts.id, [input.fromAccountId, input.toAccountId]),
          eq(moneyAccounts.currency, input.amount.currency),
          isNull(moneyAccounts.deletedAt),
        ),
      )
    if (found.length !== 2) throw new DomainError(ERROR.TRANSFER_ACCOUNT)
  }

  /**
   * The fee written as the transfer now says: added, amended or taken away. Written just before the
   * transfer, by a millisecond, so the journal shows it right under it, newest first (handoff 03).
   */
  async function writeFee(
    tx: Conn,
    actorId: string,
    transfer: Row,
    input: Omit<TransferBody, 'id'>,
    fee: FeeSpending | null,
    held: FeeRow | undefined,
  ) {
    const minor = input.fee?.minor ?? null
    if (minor === null || fee === null) {
      if (held) await tx.delete(spendings).where(eq(spendings.id, held.id))
      return
    }
    if (!held) {
      await tx.insert(spendings).values({
        id: randomUUID(),
        actorId,
        transferId: transfer.id,
        ...feeColumnsOf(input, fee, minor),
        createdAt: new Date(transfer.createdAt.getTime() - 1),
      })
      return
    }
    await tx
      .update(spendings)
      .set({
        ...feeColumnsOf(input, fee, minor),
        // The category is kept: «Прочее» renamed or archived is still the fee's.
        categoryId: held.categoryId,
        ...(held.accountId === input.fromAccountId ? {} : { accountSetAt: sql`now()` }),
        revision: held.revision + 1,
        amendedAt: sql`now()`,
      })
      .where(eq(spendings.id, held.id))
  }

  return {
    async add(actorId, input, fee) {
      return translateFailures(() =>
        db.transaction(async (tx) => {
          await tx.execute(lockOwner(actorId))
          // Past its ten minutes a removal is final whether or not the timer has come round: the
          // same name is then a new transfer, not a conflict.
          await tx
            .delete(accountTransfers)
            .where(
              and(
                eq(accountTransfers.id, input.id),
                eq(accountTransfers.actorId, actorId),
                lte(accountTransfers.deletedAt, undoFrom()),
              ),
            )
          const [same] = await tx
            .select()
            .from(accountTransfers)
            .where(eq(accountTransfers.id, input.id))
          if (same) {
            const held = await feeOf(tx, same.id)
            if (same.actorId !== actorId || same.deletedAt !== null || !says(same, held, input)) {
              throw new DomainError(ERROR.CONFLICT)
            }
            return { transfer: toTransfer(same, held), created: false }
          }
          await accountsHold(tx, actorId, input)
          const [inserted] = await tx
            .insert(accountTransfers)
            .values({ id: input.id, actorId, ...columnsOf(input) })
            .returning()
          const transfer = theRow(inserted, 'account_transfers')
          await writeFee(tx, actorId, transfer, input, fee, undefined)
          return { transfer: toTransfer(transfer, await feeOf(tx, transfer.id)), created: true }
        }),
      )
    },

    async amend(actorId, id, input, fee) {
      const own = idOrNull(id)
      if (own === null) throw new DomainError(ERROR.NOT_FOUND)
      return translateFailures(() =>
        db.transaction(async (tx) => {
          await tx.execute(lockOwner(actorId))
          const [row] = await tx
            .select()
            .from(accountTransfers)
            .where(
              and(
                eq(accountTransfers.id, own),
                eq(accountTransfers.actorId, actorId),
                isNull(accountTransfers.deletedAt),
              ),
            )
          if (!row) throw new DomainError(ERROR.NOT_FOUND)
          const held = await feeOf(tx, row.id)
          if (says(row, held, input)) return { transfer: toTransfer(row, held), amended: false }
          if (row.revision !== input.revision) throw new DomainError(ERROR.CONFLICT)
          await accountsHold(tx, actorId, input)
          await tx.insert(accountTransferRevisions).values({
            transferId: row.id,
            revision: row.revision,
            fromAccountId: row.fromAccountId,
            toAccountId: row.toAccountId,
            amountMinor: row.amountMinor,
            currency: row.currency,
            feeMinor: held?.amountMinor ?? null,
            transferredOn: row.transferredOn,
            note: row.note,
            // One moment for both, the transaction's own (MOL-42).
            replacedAt: sql`now()`,
          })
          const [amended] = await tx
            .update(accountTransfers)
            .set({ ...columnsOf(input), revision: row.revision + 1, amendedAt: sql`now()` })
            .where(eq(accountTransfers.id, row.id))
            .returning()
          const transfer = theRow(amended, 'account_transfers')
          await writeFee(tx, actorId, transfer, input, fee, held)
          return { transfer: toTransfer(transfer, await feeOf(tx, row.id)), amended: true }
        }),
      )
    },

    async byId(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return null
      const [row] = await db
        .select()
        .from(accountTransfers)
        .where(
          and(
            eq(accountTransfers.id, own),
            eq(accountTransfers.actorId, actorId),
            isNull(accountTransfers.deletedAt),
          ),
        )
      return row ? toTransfer(row, await feeOf(db, row.id)) : null
    },

    async remove(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return null
      return db.transaction(async (tx) => {
        const [removed] = await tx
          .update(accountTransfers)
          .set({ deletedAt: sql`clock_timestamp()` })
          .where(
            and(
              eq(accountTransfers.id, own),
              eq(accountTransfers.actorId, actorId),
              isNull(accountTransfers.deletedAt),
            ),
          )
          .returning()
        if (!removed) return null
        // The fee goes with it, marked at the same moment, and comes back with it.
        await tx
          .update(spendings)
          .set({ deletedAt: removed.deletedAt })
          .where(and(eq(spendings.transferId, own), isNull(spendings.deletedAt)))
        return toTransfer(removed, await feeOf(tx, own))
      })
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      return db.transaction(async (tx) => {
        const restored = await tx
          .update(accountTransfers)
          .set({ deletedAt: null })
          .where(
            and(
              eq(accountTransfers.id, own),
              eq(accountTransfers.actorId, actorId),
              // Past its time a removal is final even before the timer comes round.
              or(isNull(accountTransfers.deletedAt), gt(accountTransfers.deletedAt, undoFrom())),
            ),
          )
          .returning({ id: accountTransfers.id })
        if (restored.length === 0) return false
        await tx
          .update(spendings)
          .set({ deletedAt: null })
          .where(and(eq(spendings.transferId, own), isNotNull(spendings.deletedAt)))
        return true
      })
    },

    async purgeRemoved(actorId, except) {
      const kept = except === undefined ? null : idOrNull(except)
      // Its fee and its versions go with it, by their keys.
      await db
        .delete(accountTransfers)
        .where(
          and(
            eq(accountTransfers.actorId, actorId),
            isNotNull(accountTransfers.deletedAt),
            kept === null ? undefined : ne(accountTransfers.id, kept),
          ),
        )
    },

    async purgeStale() {
      await db
        .delete(accountTransfers)
        .where(
          and(isNotNull(accountTransfers.deletedAt), lte(accountTransfers.deletedAt, undoFrom())),
        )
    },
  }
}
