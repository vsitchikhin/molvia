import { z } from 'zod'
import { actorSchema } from '#model/entities/actor'

/**
 * The header a request names its owner with. Part of the contract rather than of the route,
 * because both ends need it: the API reads it, the client writes it, and a name spelled twice
 * is a name that can drift.
 *
 * Not the path and not a query parameter: both land in the access log, in browser history and
 * in `Referer`, and this identifier is a bearer key — whoever reads it is the owner. Not a
 * cookie either: a cookie travels on requests started by other sites, which is CSRF, and the
 * bot has no cookie jar at all.
 */
export const ACTOR_HEADER = 'x-molvia-actor'

/**
 * The owner as anyone outside the server sees them: the settings, without the identity behind
 * them (MOL-52).
 *
 * An allowlist by subtraction rather than a second list of fields, for the reason the wire
 * below is derived too — but the subtraction itself is deliberate. The epic promised that only
 * Telegram's numeric id is *stored*, not that it is shown, and «who am I» is a question about
 * settings. Left in, it would have reached `GET /actors/me` in silence: the wire is an
 * `.extend` of the entity, so no line of this file would have had to change for it.
 *
 * Not strict, and that is what does the work: `actorViewSchema.parse(actor)` is how a route
 * narrows an `Actor` to what it may send, in one visible step rather than by hoping something
 * downstream drops the field.
 */
export const actorViewSchema = actorSchema.omit({ telegramUserId: true })
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
