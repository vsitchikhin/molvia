import type { Place, SettingsGeography } from '@molvia/model'
import type { PlaceRepository } from '@/db/places-repository'

/**
 * How many places «Начать поход» offers to tap. A person shops in a handful, and at the door
 * of the shop a short list to tap beats a field to type into (MOL-21, В-1).
 */
export const RECENT_PLACES = 5

export async function recentPlaces(
  places: PlaceRepository,
  actorId: string,
  geography?: SettingsGeography,
): Promise<Place[]> {
  return places.recentFor(actorId, RECENT_PLACES, geography)
}
