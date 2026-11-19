import { ref } from 'vue'
import type { Ref } from 'vue'
import { placeCategoriesOf, refreshPlaceCategories } from '@/stores/placeCategories'

/**
 * The places' last categories for a screen's guess (MOL-400, Р-6): what the phone keeps at once, the server's answer
 * laid over it when it comes. One for the review of a receipt and its row in «Покупки» (MOL-406), so both guess alike.
 */
export function usePlaceCategories(
  owner: string | null,
): Ref<{ readonly placeId: string; readonly categoryId: string }[]> {
  const places = ref(placeCategoriesOf(owner))
  void refreshPlaceCategories(owner).then(() => {
    places.value = placeCategoriesOf(owner)
  })
  return places
}
