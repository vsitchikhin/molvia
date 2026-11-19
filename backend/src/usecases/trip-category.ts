import { DomainError, ERROR } from '@molvia/model'
import type { Actor, PlaceCategories, TripCategoryBody } from '@molvia/model'
import type { TripRepositories } from '@/db/unit-of-work'

/**
 * The trip's category as the server takes it (MOL-400): one of the owner's, a removed one too — what was
 * queued offline is not lost to a chip taken away on another phone — else `null`, no word. One the person has
 * not got is never a refusal: the write came from a queue, and a refusal would set it aside.
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

/**
 * `PUT /trips/:id/category` (MOL-400): chosen at «Закончить» or changed in «Траты». A category the person has not
 * got moves nothing, the trip keeping the one it has (adversarial А1): it is one still on its way in another
 * queue, or gone on another phone — written as «Продукты», it took a choice made before with it.
 */
export async function categorizeTrip(
  repositories: Pick<TripRepositories, 'trips' | 'spendingCategories'>,
  owner: Pick<Actor, 'id'>,
  tripId: string,
  body: TripCategoryBody,
): Promise<void> {
  const categoryId = await ownCategory(repositories, owner, body.categoryId)
  const found =
    categoryId === null
      ? (await repositories.trips.byId(tripId, owner.id)) !== null
      : await repositories.trips.setCategory(owner.id, tripId, categoryId)
  if (!found) throw new DomainError(ERROR.NOT_FOUND)
}

/** `GET /trips/place-categories` (MOL-400, Р-6): what the phone starts a trip at a place on. */
export async function placeCategoriesOf(
  repositories: Pick<TripRepositories, 'trips'>,
  owner: Pick<Actor, 'id'>,
): Promise<PlaceCategories> {
  return { places: [...(await repositories.trips.placeCategories(owner.id))] }
}
