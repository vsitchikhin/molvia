import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import {
  PAYMENT_KEEP_YEARS,
  accessOf,
  extendedUntil,
  refundSum,
  refundedUntil,
} from '@molvia/model'
import type {
  ExchangeRate,
  Money,
  PaidAccess,
  PaymentChannel,
  PaymentState,
  PaymentTariff,
} from '@molvia/model'
import type { Conn, Db } from './index'
import { actors, payments, rfCardDays } from './schema'
import { yerevanDay } from './yerevan-week'
import { theRow } from './rows'

/** A payment as the journal keeps it: what a channel needs to ask about it, and its state. */
export interface PaymentRow {
  readonly id: string
  readonly orderNo: bigint
  readonly actorId: string | null
  readonly tariff: PaymentTariff
  readonly amount: Money
  readonly refundedMinor: bigint
  readonly channel: PaymentChannel
  readonly channelRef: string | null
  readonly state: PaymentState
  readonly createdAt: Date
}

export interface NewPayment {
  readonly id: string
  readonly actorId: string
  readonly tariff: PaymentTariff
  /** The dollar anchor, in cents. */
  readonly anchor: Money
  /** Drams per dollar, the CBA's rate the price was made at — kept with the moment it is of. */
  readonly rate: ExchangeRate
  readonly amount: Money
  readonly channel: PaymentChannel
}

/** The channel's own numbers a payment keeps once paid: by them the bank finds the rest (MOL-281 §8). */
export interface PaidFacts {
  readonly rrn: string | null
  readonly approvalCode: string | null
}

/** Where a person's access stands after a payment moved it, by the columns of `actors`; absent — not moved. */
export interface AccessMoved {
  readonly sharedUntil?: Date | null
  readonly receiptsModelUntil?: Date | null
}

/** What a word of the channel did: `moved` only for the one word that changed the payment. */
export interface Settled {
  readonly state: PaymentState
  readonly moved: boolean
  readonly access: AccessMoved
}

/** Where a person's paid access ends, by the columns of `actors`. */
export interface PaidUntil {
  readonly sharedUntil: Date | null
  readonly receiptsModelUntil: Date | null
}

export interface PaymentsRepository {
  create(payment: NewPayment): Promise<{ orderNo: bigint }>
  /**
   * The payment written only while the person started fewer than `max` since `since` (MOL-277, Р-12) — counted under
   * their row's lock, so two at once never both pass the last place; `null` past it, nothing written. An erased
   * person has no row and starts nothing.
   */
  createWithin(payment: NewPayment, max: number, since: Date): Promise<{ orderNo: bigint } | null>
  /** Where the person's paid access ends now; `null` — no such person. */
  paidUntil(actorId: string): Promise<PaidUntil | null>
  /**
   * The channel's payments still «created» since `upTo` or longer, the oldest first, at most `limit` — what the
   * minute's reconciliation asks the bank of (MOL-277, requirement 6).
   */
  pending(channel: PaymentChannel, upTo: Date, limit: number): Promise<readonly PaymentRow[]>
  /** A tap of «У меня только карта РФ» counted on today's Yerevan day — `again`, the device's own repeat (Р-8). */
  tapRfCard(again: boolean): Promise<void>
  /** The channel's payments of these order numbers. */
  byOrders(channel: PaymentChannel, orderNos: readonly bigint[]): Promise<readonly PaymentRow[]>
  /** The channel's payments paid within `[from, to)` — what the bank's list of the period must hold. */
  paidWithin(channel: PaymentChannel, from: Date, to: Date): Promise<readonly PaymentRow[]>
  /** The channel's name of the payment: given once, a later name — the same or another — changes nothing. */
  named(id: string, channelRef: string): Promise<void>
  get(id: string): Promise<PaymentRow | null>
  /**
   * Created → paid, and the access its tariff extends, in one transaction — exactly once (owner, 12.11.2026):
   * whichever word comes first, the return page or a reconciliation, the others find it paid and move nothing.
   * Abandoned is our judgement of a page outlived, never the bank's, so the bank's «paid» after it is paid
   * too (adversarial А2); declined is the bank's own word and stays.
   */
  markPaid(id: string, facts: PaidFacts, now: Date): Promise<Settled | null>
  /** Created → declined or abandoned; anything else is left as it is. */
  markClosed(id: string, state: 'declined' | 'abandoned', now: Date): Promise<Settled | null>
  /**
   * A refund of `minor` of a paid payment (MOL-277, owner's В-2 «а»): refunds add up, never past the amount; the one
   * that makes it whole takes back the thirty days, never earlier than `now`.
   */
  refund(id: string, minor: bigint, now: Date): Promise<Settled | null>
  /**
   * Deletes every payment three years (`PAYMENT_KEEP_YEARS`) past its last movement — and a paid one past the end of
   * its days too; how many went.
   */
  sweep(now: Date): Promise<number>
}

const COLUMN = { shared: 'sharedUntil', receipts: 'receiptsModelUntil' } as const
type Column = (typeof COLUMN)[PaidAccess]

/** The states «paid» may come to: the bank's word over our «abandoned» (adversarial А2). */
const PAYABLE: readonly PaymentState[] = ['created', 'abandoned']

const at = (now: Date) => sql`${now.toISOString()}::timestamptz`

/**
 * The person whose payment it is, locked for the change of their access — the person's row first, then the
 * payment, as every writer of a person's rows takes them. Nobody — the payment is unknown or its person erased.
 */
async function lockedOwner(tx: Conn, id: string) {
  const [owner] = await tx
    .select({
      id: actors.id,
      sharedUntil: actors.sharedUntil,
      receiptsModelUntil: actors.receiptsModelUntil,
    })
    .from(actors)
    .where(
      sql`${actors.id} = (select ${payments.actorId} from ${payments} where ${payments.id} = ${id})`,
    )
    .for('no key update')
  return owner ?? null
}

type Owner = NonNullable<Awaited<ReturnType<typeof lockedOwner>>>

/** Writes the access `opens` moved by `move`, and says where each now stands. */
async function moveAccess(
  tx: Conn,
  owner: Owner,
  opens: readonly PaidAccess[],
  move: (until: Date | null, column: Column) => Date | null,
): Promise<AccessMoved> {
  if (opens.length === 0) return {}
  const set: Partial<Record<Column, Date | null>> = {}
  for (const access of opens) set[COLUMN[access]] = move(owner[COLUMN[access]], COLUMN[access])
  await tx.update(actors).set(set).where(eq(actors.id, owner.id))
  return set
}

/**
 * After a whole refund took `shift` of `column` out of the person's access, the days of every later payment of
 * theirs come that much earlier: their stored ends move with them, or the next refund reads an end that is gone and
 * takes a later payment's days (adversarial Б1). Later is an end past the refunded one — an extension from the end
 * of a running term is never apart from it while any of its days is to come.
 */
async function shiftLater(
  tx: Conn,
  actorId: string,
  column: Column,
  end: Date,
  shift: number,
): Promise<void> {
  const moved = sql`${payments[column]} - make_interval(secs => ${shift / 1000}::double precision)`
  await tx
    .update(payments)
    .set(column === 'sharedUntil' ? { sharedUntil: moved } : { receiptsModelUntil: moved })
    .where(
      and(eq(payments.actorId, actorId), eq(payments.state, 'paid'), gt(payments[column], end)),
    )
}

async function stateOf(tx: Conn, id: string): Promise<PaymentState | null> {
  const [row] = await tx.select({ state: payments.state }).from(payments).where(eq(payments.id, id))
  return row?.state ?? null
}

function paymentRowOf(row: typeof payments.$inferSelect): PaymentRow {
  return {
    id: row.id,
    orderNo: row.orderNo,
    actorId: row.actorId,
    tariff: row.tariff,
    amount: { minor: row.amountMinor, currency: row.currency },
    refundedMinor: row.refundedMinor,
    channel: row.channel,
    channelRef: row.channelRef,
    state: row.state,
    createdAt: row.createdAt,
  }
}

function rowOf(payment: NewPayment) {
  return {
    id: payment.id,
    actorId: payment.actorId,
    tariff: payment.tariff,
    anchorMinor: payment.anchor.minor,
    anchorCurrency: payment.anchor.currency,
    rateScaled: payment.rate.scaled,
    rateAsOf: payment.rate.asOf,
    amountMinor: payment.amount.minor,
    currency: payment.amount.currency,
    channel: payment.channel,
  }
}

export function createPaymentsRepository(db: Db): PaymentsRepository {
  return {
    async create(payment) {
      const [created] = await db
        .insert(payments)
        .values(rowOf(payment))
        .returning({ orderNo: payments.orderNo })
      return theRow(created, 'payments')
    },

    async createWithin(payment, max, since) {
      return db.transaction(async (tx) => {
        const [person] = await tx
          .select({ id: actors.id })
          .from(actors)
          .where(eq(actors.id, payment.actorId))
          .for('no key update')
        if (person === undefined) return null
        const [{ started } = { started: 0 }] = await tx
          .select({ started: sql<number>`count(*)::int` })
          .from(payments)
          .where(and(eq(payments.actorId, payment.actorId), gt(payments.createdAt, since)))
        if (started >= max) return null
        const [created] = await tx
          .insert(payments)
          .values(rowOf(payment))
          .returning({ orderNo: payments.orderNo })
        return theRow(created, 'payments')
      })
    },

    async pending(channel, upTo, limit) {
      const rows = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.channel, channel),
            eq(payments.state, 'created'),
            lte(payments.createdAt, upTo),
          ),
        )
        .orderBy(payments.orderNo)
        .limit(limit)
      return rows.map(paymentRowOf)
    },

    async tapRfCard(again) {
      const day = yerevanDay(sql`now()`)
      await db.execute(sql`
        insert into ${rfCardDays} (day, taps, again) values (${day}, 1, ${again ? 1 : 0})
        on conflict (day) do update set
          taps = ${rfCardDays.taps} + 1,
          again = ${rfCardDays.again} + ${again ? 1 : 0}`)
    },

    async byOrders(channel, orderNos) {
      if (orderNos.length === 0) return []
      const rows = await db
        .select()
        .from(payments)
        .where(and(eq(payments.channel, channel), inArray(payments.orderNo, [...orderNos])))
        .orderBy(payments.orderNo)
      return rows.map(paymentRowOf)
    },

    async paidWithin(channel, from, to) {
      const rows = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.channel, channel),
            sql`${payments.paidAt} >= ${at(from)}`,
            sql`${payments.paidAt} < ${at(to)}`,
          ),
        )
        .orderBy(payments.orderNo)
      return rows.map(paymentRowOf)
    },

    async paidUntil(actorId) {
      const [person] = await db
        .select({
          sharedUntil: actors.sharedUntil,
          receiptsModelUntil: actors.receiptsModelUntil,
        })
        .from(actors)
        .where(eq(actors.id, actorId))
      return person ?? null
    },

    async named(id, channelRef) {
      await db
        .update(payments)
        .set({ channelRef })
        .where(and(eq(payments.id, id), sql`${payments.channelRef} is null`))
    },

    async get(id) {
      const [row] = await db.select().from(payments).where(eq(payments.id, id))
      return row === undefined ? null : paymentRowOf(row)
    },

    async markPaid(id, facts, now) {
      return db.transaction(async (tx) => {
        const owner = await lockedOwner(tx, id)
        const [paid] = await tx
          .update(payments)
          .set({
            state: 'paid',
            paidAt: now,
            closedAt: null,
            movedAt: now,
            rrn: facts.rrn,
            approvalCode: facts.approvalCode,
          })
          .where(and(eq(payments.id, id), inArray(payments.state, PAYABLE)))
          .returning({ tariff: payments.tariff })
        if (paid === undefined) {
          const state = await stateOf(tx, id)
          return state === null ? null : { state, moved: false, access: {} }
        }
        const access =
          owner === null
            ? {}
            : await moveAccess(tx, owner, accessOf(paid.tariff), (until) =>
                extendedUntil(until, now),
              )
        // The payment keeps where its days end, so a whole refund knows which are still to come (А1).
        if (Object.keys(access).length > 0) {
          await tx.update(payments).set(access).where(eq(payments.id, id))
        }
        return { state: 'paid', moved: true, access }
      })
    },

    async markClosed(id, state, now) {
      return db.transaction(async (tx) => {
        const [closed] = await tx
          .update(payments)
          .set({ state, closedAt: now, movedAt: now })
          .where(and(eq(payments.id, id), eq(payments.state, 'created')))
          .returning({ state: payments.state })
        if (closed !== undefined) return { state, moved: true, access: {} }
        const current = await stateOf(tx, id)
        return current === null ? null : { state: current, moved: false, access: {} }
      })
    },

    async refund(id, minor, now) {
      return db.transaction(async (tx) => {
        const owner = await lockedOwner(tx, id)
        const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for('update')
        if (payment === undefined) return null
        const refunded = payment.refundedMinor + refundSum(payment, minor)
        const whole = refunded === payment.amountMinor
        await tx
          .update(payments)
          .set({
            refundedMinor: refunded,
            movedAt: now,
            ...(whole ? { state: 'refunded' as const, closedAt: now } : {}),
          })
          .where(eq(payments.id, id))
        if (!whole || owner === null) {
          return { state: whole ? 'refunded' : 'paid', moved: true, access: {} }
        }
        const access = await moveAccess(tx, owner, accessOf(payment.tariff), (until, column) =>
          refundedUntil(until, payment[column], now),
        )
        // The later payments' ends move by what the access moved — one shift, decided once (review №11).
        for (const column of Object.keys(access) as Column[]) {
          const before = owner[column]
          const after = access[column]
          const end = payment[column]
          if (before && after && end && before > after) {
            await shiftLater(tx, owner.id, column, end, before.getTime() - after.getTime())
          }
        }
        return { state: 'refunded', moved: true, access }
      })
    },

    async sweep(now) {
      // A paid payment's days count as its movement: while any of them is to come a refund takes them back and the
      // journal is what the access was paid by (adversarial Д1). A refunded one's ends are gone with its days.
      const last = sql`greatest(${payments.movedAt}, case when ${payments.state} = 'paid'
        then greatest(${payments.sharedUntil}, ${payments.receiptsModelUntil}) end)`
      const kept = sql`${at(now)} - make_interval(years => ${PAYMENT_KEEP_YEARS})`
      // `moved_at` first, though `last` is never below it: the index leaves the young rows out (review №12).
      const gone = await db
        .delete(payments)
        .where(and(lte(payments.movedAt, kept), sql`${last} <= ${kept}`))
        .returning({ id: payments.id })
      return gone.length
    },
  }
}
