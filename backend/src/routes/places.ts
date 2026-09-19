import { z } from 'zod'
import { recentPlacesResponseSchema, tripPlaceOf } from '@molvia/model'
import type { Place } from '@molvia/model'
import type { FastifyInstance } from 'fastify'

export interface PlacesApi {
  recent(actorId: string): Promise<Place[]>
}

/**
 * The places a person already shopped in, to tap at the door instead of typing (MOL-21, В-1).
 * Personal — where someone buys is theirs — so it is guarded and never cached.
 */
export function placeRoutes(app: FastifyInstance, api: PlacesApi): void {
  app.get('/places/recent', { exposeHeadRoute: false }, async (request, reply) => {
    const places = await api.recent(request.actorId)
    return reply
      .header('cache-control', 'no-store')
      .send(z.encode(recentPlacesResponseSchema, { places: places.map(tripPlaceOf) }))
  })
}
