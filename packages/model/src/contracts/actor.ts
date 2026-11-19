import { z } from 'zod'
import { actorSchema } from '#model/entities/actor'
import { RECEIPTS_MODEL_MONTH_MAX, RECEIPT_TRIAL } from '#model/entities/model-spend'

/**
 * The cookie a request proves itself with (MOL-53). It replaced `X-Molvia-Actor`, a header
 * carrying the owner's own uuid — that is, a name and a password that were one value.
 *
 * Here rather than in the route although only the server ever touches it: the server sets it,
 * the end-to-end suite asserts it and MOL-54 hands out the same one, and a name spelled three
 * times is a name that can drift. The **client never reads it** — that is the point of
 * `HttpOnly`, and `@molvia/client` has no notion of identity left at all.
 *
 * The comment this replaced argued *against* a cookie on two grounds, and both fell away with
 * the thing they described. «A cookie travels on requests started by other sites» — it does
 * not, with `SameSite`, and every handle that writes is `POST`, `PUT` or `DELETE`. «The bot has
 * no cookie jar» — the bot stopped being a client with an identity: in MOL-54 it reaches the
 * API over an internal channel with its own secret, not as a person.
 *
 * What did not change is why this is not a path or a query parameter: both land in the access
 * log, in browser history and in `Referer`, and the value is still a bearer key.
 *
 * **The `__Host-` prefix is a promise the browser keeps for us** (owner's decision 22.09.2026).
 * A cookie so named is refused unless it carries `Secure`, has `Path=/` and names no `Domain` —
 * all three of which this one already does. What it buys is the half we could not hold
 * ourselves: **nothing else on this host may set a cookie of this name with a deeper path**. The
 * server refuses two cookies of one name anyway (А2), so this is a second lock on the same door
 * rather than the only one; the difference is that the browser turns the attempt away before it
 * is ever sent, instead of the person meeting a 401 they cannot clear.
 */
export const SESSION_COOKIE = '__Host-molvia_session'

/**
 * Where a person stands with the model that reads receipts (MOL-275): until when it is paid — none where nothing is —
 * the trial's receipts left of ten, and of the phone's month the receipts it read of a hundred. Every figure the
 * server's, for MOL-276's screen.
 */
export const receiptsAccessSchema = z.strictObject({
  until: z.date().nullable(),
  /**
   * When a paid reading ran out, by the server's clock (MOL-276, adversarial А2): none while it is to come or was
   * never set. Beside `until`, which is none for both, it tells a person who had paid from one who never did — not
   * which of the two closed last, the grant or the trial (Б1).
   */
  ended: z.date().nullable(),
  trialLeft: z.int().min(0).max(RECEIPT_TRIAL),
  trialOf: z.literal(RECEIPT_TRIAL),
  /** The first day of the phone's month the count is of, `YYYY-MM-01`. */
  month: z.iso.date(),
  read: z.int().min(0),
  limit: z.literal(RECEIPTS_MODEL_MONTH_MAX),
})
export type ReceiptsAccess = z.infer<typeof receiptsAccessSchema>

/** Why the model reads the person's receipts no more (MOL-276). */
export type ReceiptsClosed = 'trial' | 'ended' | 'month'

/**
 * Why the model reads the person's receipts no more (MOL-276), by the server's figures alone — the tariff of
 * `tariffOpens`: nothing paid and the trial spent is `trial`, or `ended` where a paid reading ran out besides
 * (adversarial А2) — both are so then, and its words say both, since which closed last the figures do not tell (Б1);
 * the month's hundred read is `month`; none while it is open. `until` is already none for a date gone by the
 * server's clock, so the phone's is never asked. The person's share and the month's cap close nothing here: the server
 * does not say them (MOL-367).
 */
export function receiptsClosedBy(access: ReceiptsAccess): ReceiptsClosed | null {
  if (access.until === null && access.trialLeft === 0) return access.ended ? 'ended' : 'trial'
  return access.read >= access.limit ? 'month' : null
}

/**
 * The same on the wire, its moments as ISO. `ended` came after the first server that said the rest, so an answer
 * without it — a server rolled back — reads as none.
 */
const receiptsAccessWireSchema = receiptsAccessSchema.extend({
  until: z.iso.datetime().nullable(),
  ended: z.iso.datetime().nullable().optional(),
})

/**
 * The owner as anyone outside the server sees them: the settings, without the identity behind
 * them (MOL-52).
 *
 * **An allowlist — `pick`, not `omit`** — and the difference is the whole safeguard, as it is
 * for `catalogueEntrySchema`. Written by subtraction it protected against exactly one field,
 * the one already known about: the *next* field added to `Actor` would have joined this view,
 * and then the wire, without a line of this file changing (adversarial Б2). Written by
 * addition, a new field stays on the server until somebody names it here.
 *
 * The rule it enforces is the epic's: only Telegram's numeric id is *stored*, not shown, and
 * «who am I» is a question about settings.
 */
export const actorViewSchema = actorSchema
  .pick({
    id: true,
    country: true,
    city: true,
    spendCurrency: true,
    incomeCurrency: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    /**
     * Whether the model reads this person's receipts now (MOL-408, owner's В-2 «а»): Georgia's receipts are read by
     * it alone, so its camera is there only for them. Sent by `/actors/me` alone, and only to a phone that asks
     * (`RECEIPTS_BY_MODEL_HEADER`): an installed app of an earlier build reads the answer strictly. Absent is
     * «not said», never «no».
     */
    receiptsByModel: z.boolean().optional(),
    /**
     * Where the person stands with the model that reads receipts (MOL-275, `receiptsAccessSchema`). Sent by
     * `/actors/me` alone, only to a phone that asks (`RECEIPTS_ACCESS_HEADER`), as `receiptsByModel` is.
     */
    receiptsAccess: receiptsAccessSchema.optional(),
  })
export type ActorView = z.infer<typeof actorViewSchema>

/**
 * The first entity to cross the wire, so the shape chosen here is the shape the trip,
 * the verdict and the exchange will take after it (MOL-21, MOL-27, MOL-42).
 *
 * In the domain the timestamps are `Date`; in JSON they are strings. An entity handed back
 * unchanged would fail `actorSchema.parse` in `packages/client` on its very first field —
 * which is why money and quantity already cross this border through codecs.
 *
 * Derived from the view rather than retyped beside it: a field added to `Actor` and forgotten
 * here would leave the wire quietly behind, and the first sign of it would be an `encode`
 * dropping data nobody noticed was missing.
 *
 * Strict, on the client's side as much as the server's, and for the same reason
 * `catalogueEntryCodec` is: a reply that grew a field fails to parse rather than carrying it
 * past a client that simply never reads it — which is how a leak would otherwise go unnoticed.
 *
 * `sharedUntil` (MOL-31, Р-9) is therefore **not** here: the allowlist above never named it,
 * and no screen of 0.1 says «access until». The thing a screen acts on — whose figures it is
 * being shown — travels with the answer that carries them, as `scope`. It joins the wire with
 * the screen that grants or sells access, by being named in the view, not by being derived.
 */
export const actorWireSchema = z.strictObject({
  ...actorViewSchema.shape,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  receiptsAccess: receiptsAccessWireSchema.optional(),
})
export type ActorWire = z.infer<typeof actorWireSchema>

/**
 * Unlike `moneyCodec` and `rateCodec` there is no `payload.issues` branch here, and the
 * absence is deliberate rather than forgotten: a date has no value that passes the schema
 * and still fails to become one. `z.iso.datetime()` refuses everything `new Date` would turn
 * into an Invalid Date, so by the time decode runs there is nothing left to report.
 */
export const actorCodec = z.codec(actorWireSchema, actorViewSchema, {
  decode: ({ receiptsAccess, ...wire }) => ({
    ...wire,
    createdAt: new Date(wire.createdAt),
    updatedAt: new Date(wire.updatedAt),
    ...(receiptsAccess === undefined
      ? {}
      : {
          receiptsAccess: {
            ...receiptsAccess,
            until: receiptsAccess.until === null ? null : new Date(receiptsAccess.until),
            ended: receiptsAccess.ended == null ? null : new Date(receiptsAccess.ended),
          },
        }),
  }),
  encode: ({ receiptsAccess, ...actor }) => ({
    ...actor,
    createdAt: actor.createdAt.toISOString(),
    updatedAt: actor.updatedAt.toISOString(),
    ...(receiptsAccess === undefined
      ? {}
      : {
          receiptsAccess: {
            ...receiptsAccess,
            until: receiptsAccess.until === null ? null : receiptsAccess.until.toISOString(),
            ended: receiptsAccess.ended === null ? null : receiptsAccess.ended.toISOString(),
          },
        }),
  }),
})

/** The header a phone asks `/actors/me` for `receiptsByModel` by (MOL-408). */
export const RECEIPTS_BY_MODEL_HEADER = 'X-Molvia-Receipts-By-Model'

/** The header a phone asks `/actors/me` for `receiptsAccess` by (MOL-275). */
export const RECEIPTS_ACCESS_HEADER = 'X-Molvia-Receipts-Access'
