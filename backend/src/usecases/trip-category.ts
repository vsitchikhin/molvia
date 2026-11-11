import { DomainError, ERROR } from '@molvia/model'
import type { Actor, PlaceCategories, TripCategoryBody } from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

/**
 * The trip's category as the server writes it (MOL-400): one of the owner's, a removed one too — what was
 * queued offline is not lost to a chip taken away on another phone — else `null`, «Продукты». One the
 * person has not got is never a refusal: the write came from a queue, and a refusal would set it aside.
 */
export async function ownCategory(
  repositories: Pick<TripRepositories, 'spendingCategories'>,
  owner: Pick<Actor, 'id'>,
  categoryId: string | undefined,
): Promise<string | null> {
  if (categoryId === undefined) return null
  const wanted = categoryId.toLowerCase()
  const categories = await repositories.spendingCategories.list(owner.id)
  return categories.some((category) => category.id === wanted) ? wanted : null
}

/** `PUT /trips/:id/category` (MOL-400): chosen at «Закончить» or changed in «Траты». */
export async function categorizeTrip(
  repositories: Pick<TripRepositories, 'trips' | 'spendingCategories'>,
  owner: Pick<Actor, 'id'>,
  tripId: string,
  body: TripCategoryBody,
): Promise<void> {
  const categoryId = await ownCategory(repositories, owner, body.categoryId)
  if (!(await repositories.trips.setCategory(owner.id, tripId, categoryId))) {
    throw new DomainError(ERROR.NOT_FOUND)
  }
}

/** `GET /trips/place-categories` (MOL-400, Р-6): what the phone starts a trip at a place on. */
export async function placeCategoriesOf(
  repositories: Pick<TripRepositories, 'trips'>,
  owner: Pick<Actor, 'id'>,
): Promise<PlaceCategories> {
  return { places: [...(await repositories.trips.placeCategories(owner.id))] }
}
