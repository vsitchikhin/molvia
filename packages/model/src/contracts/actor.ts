import { z } from 'zod'
import { actorSchema } from '#model/entities/actor'

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
 */
export const SESSION_COOKIE = 'molvia_session'

/**
 * What it replaced. The server stopped reading it in this very commit; it stays alive for one
 * more because `@molvia/client` and the PWA still write it, and they are taken off it — with
 * everything else that treated `actors.id` as a password — in the commit after this one.
 */
export const ACTOR_HEADER = 'x-molvia-actor'

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
export const actorViewSchema = actorSchema.pick({
  id: true,
  country: true,
  city: true,
  spendCurrency: true,
  incomeCurrency: true,
  createdAt: true,
  updatedAt: true,
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
})
export type ActorWire = z.infer<typeof actorWireSchema>

/**
 * Unlike `moneyCodec` and `rateCodec` there is no `payload.issues` branch here, and the
 * absence is deliberate rather than forgotten: a date has no value that passes the schema
 * and still fails to become one. `z.iso.datetime()` refuses everything `new Date` would turn
 * into an Invalid Date, so by the time decode runs there is nothing left to report.
 */
export const actorCodec = z.codec(actorWireSchema, actorViewSchema, {
  decode: (wire) => ({
    ...wire,
    createdAt: new Date(wire.createdAt),
    updatedAt: new Date(wire.updatedAt),
  }),
  encode: (actor) => ({
    ...actor,
    createdAt: actor.createdAt.toISOString(),
    updatedAt: actor.updatedAt.toISOString(),
  }),
})
