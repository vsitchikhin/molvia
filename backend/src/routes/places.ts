import { z } from 'zod'
import { parseQuery } from '@/parse'
import { recentPlacesResponseSchema, tripPlaceOf, settingsGeographySchema } from '@molvia/model'
import type { Place, SettingsGeography } from '@molvia/model'
import type { FastifyInstance } from 'fastify'

export interface PlacesApi {
  recent(actorId: string, geography?: SettingsGeography): Promise<Place[]>
}

/**
 * The places a person already shopped in, to tap at the door instead of typing (MOL-21, В-1).
 * Personal — where someone buys is theirs — so it is guarded and never cached.
 */
export function placeRoutes(app: FastifyInstance, api: PlacesApi): void {
  app.get('/places/recent', { exposeHeadRoute: false }, async (request, reply) => {
    // Read leniently, and only the pair filters. A strict shape answered 400 to a parameter
    // nobody here wrote — a cache-buster, one a proxy or a shop's captive portal appended —
    // and to half a pair as well (MOL-65, adversarial Г3). What is filtered is this person's
    // own trips, so falling back to the whole list discloses nothing.
    const query = parseQuery(z.looseObject({}), request.query)
    const geography = settingsGeographySchema.safeParse({
      country: query.country,
      city: query.city,
    })
    const places = await api.recent(request.actorId, geography.data)
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(recentPlacesResponseSchema, { places: places.map(tripPlaceOf) }))
  })
}
