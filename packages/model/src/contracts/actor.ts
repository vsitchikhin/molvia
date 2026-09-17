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
 * The door of the first visit. A header rather than a body field: creating an identity has no
 * body on purpose — the only thing a client could send is the four settings, and no screen
 * sets them in 0.1 — so adding one to carry a code would break the decision it protects.
 *
 * It is not a second identity. It says «you were invited»; the actor header says «you are
 * this person», and only the second is checked on every later request.
 */
export const INVITE_HEADER = 'x-molvia-invite'

/**
 * The first entity to cross the wire whole, so the shape chosen here is the shape the trip,
 * the verdict and the exchange will take after it (MOL-21, MOL-27, MOL-42).
 *
 * In the domain the timestamps are `Date`; in JSON they are strings. An entity handed back
 * unchanged would fail `actorSchema.parse` in `packages/client` on its very first field —
 * which is why money and quantity already cross this border through codecs.
 *
 * Derived from the entity rather than retyped beside it: a field added to `Actor` and
 * forgotten here would leave the wire quietly behind, and the first sign of it would be an
 * `encode` dropping data nobody noticed was missing.
 */
export const actorWireSchema = actorSchema.extend({
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
export const actorCodec = z.codec(actorWireSchema, actorSchema, {
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
