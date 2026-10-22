import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpendingCategoryView } from '@molvia/model'
import { api } from '@/api'
import { categoriesWith } from '@/components/spending'
import { recallCategories } from '@/composables/useMoneyMonth'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

export interface OwnCategories {
  readonly categories: ComputedRef<SpendingCategoryView[]>
  readonly nameOf: (category: SpendingCategoryView) => string
  /** The category's name by its id, «Прочее» when the phone does not know it. */
  readonly nameById: (id: string | null) => string
}

/**
 * The owner's categories away from the month (MOL-123): the journal of an account, «не попали» and
 * the check name and draw a spending by its category, and a spending opened there is amended in the
 * sheet of «Деньги». They are the owner's, not a month's: any month kept on the phone names them,
 * and the server's list is asked once the screen is up — with the ones waiting in the queue on top.
 */
export function useOwnCategories(): OwnCategories {
  const { t } = useI18n()
  const actor = useActorStore()
  const queue = useSpendingQueueStore()
  const server = ref<SpendingCategoryView[]>(actor.id ? recallCategories(actor.id) : [])
  // When the list was asked for; none for one recalled from a month kept on the phone.
  const askedAt = ref<Date | null>(null)

  async function load(): Promise<void> {
    const owner = actor.id
    if (!owner) return
    const asked = new Date()
    try {
      const { categories } = await api.spendingCategories()
      if (actor.id !== owner) return
      server.value = categories
      askedAt.value = asked
    } catch {
      // Whatever the phone remembers stands; a name unknown reads «Прочее».
    }
  }
  onMounted(() => void load())
  watch(
    () => actor.id,
    (id) => {
      server.value = id ? recallCategories(id) : []
      askedAt.value = null
      void load()
    },
  )

  const categories = computed(() =>
    categoriesWith(server.value, [...queue.arrived, ...queue.pending], askedAt.value),
  )
  function nameOf(category: SpendingCategoryView): string {
    return category.preset ? t(`spending.category.${category.preset}`) : (category.name ?? '')
  }
  function nameById(id: string | null): string {
    const found = categories.value.find((category) => category.id === id)
    return found ? nameOf(found) : t('spending.category.other')
  }
  return { categories, nameOf, nameById }
}
