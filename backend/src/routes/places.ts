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
    const query = parseQuery(z.union([settingsGeographySchema, z.strictObject({})]), request.query)
    const places = await api.recent(
      request.actorId,
      typeof query.country === 'string' && typeof query.city === 'string'
        ? { country: query.country, city: query.city }
        : undefined,
    )
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(recentPlacesResponseSchema, { places: places.map(tripPlaceOf) }))
  })
}
