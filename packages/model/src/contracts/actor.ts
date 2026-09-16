import { z } from 'zod'
import { actorSchema } from '#model/entities/actor'
import { citySchema, countrySchema } from '#model/values/geo'
import { currencySchema } from '#model/values/money'

/**
 * The first entity to cross the wire whole, so the shape chosen here is the shape the trip,
 * the verdict and the exchange will take after it (MOL-21, MOL-27, MOL-42).
 *
 * In the domain the timestamps are `Date`; in JSON they are strings. An entity handed back
 * unchanged would fail `actorSchema.parse` in `packages/client` on its very first field —
 * which is why money and quantity already cross this border through codecs.
 */
export const actorWireSchema = z.object({
  id: z.uuid(),
  country: countrySchema,
  city: citySchema,
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
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
