import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SpendingCategoryView } from '@molvia/model'
import { api } from '@/api'
import { categoriesWith } from '@/components/spending'
import { recallCategories, recallFrequent } from '@/composables/useMoneyMonth'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

export interface OwnCategories {
  readonly categories: ComputedRef<SpendingCategoryView[]>
  /** The ids the chips of a spending stand first by (MOL-198), of the same answer. */
  readonly frequent: ComputedRef<readonly string[]>
  readonly nameOf: (category: SpendingCategoryView) => string
  /** The category's name by its id, «Прочее» when the phone does not know it. */
  readonly nameById: (id: string | null) => string
}

/**
 * The owner's categories away from the month (MOL-123): the journal of an account, «не попали» and
 * the check name and draw a spending by its category, and a spending opened there is amended in the
 * sheet of «Деньги». They are the owner's, not a month's: any month kept on the phone names them,
 * and the server's list is asked once the screen is up, and again whenever a write of the queue lands
 * — with the ones waiting in the queue on top.
 */
export function useOwnCategories(): OwnCategories {
  const { t } = useI18n()
  const actor = useActorStore()
  const queue = useSpendingQueueStore()
  const server = ref<SpendingCategoryView[]>(actor.id ? recallCategories(actor.id) : [])
  const serverFrequent = ref<readonly string[]>(actor.id ? recallFrequent(actor.id) : [])
  // When the list was asked for; none for one recalled from a month kept on the phone.
  const askedAt = ref<Date | null>(null)

  // Reads go out on every write landed, and may answer out of turn: an answer is never laid over one
  // that set out later (review 2, Р2-А2) — as a month of «Деньги» is never kept over one (MOL-262, А6).
  let sent = 0
  let laid = 0
  async function load(): Promise<void> {
    const owner = actor.id
    if (!owner) return
    const asked = new Date()
    const mine = ++sent
    try {
      const { categories, frequent } = await api.spendingCategories()
      if (actor.id !== owner || mine < laid) return
      laid = mine
      server.value = categories
      serverFrequent.value = frequent
      askedAt.value = asked
    } catch {
      // Whatever the phone remembers stands; a name unknown reads «Прочее».
    }
  }
  onMounted(() => void load())
  // A spending landed moves the chips' frequency, as «Деньги» read their month again on it (MOL-198,
  // adversarial А3): the next sheet on an account's screen stands its chips by the order after it.
  watch(
    () => queue.landed,
    () => void load(),
  )
  watch(
    () => actor.id,
    (id) => {
      server.value = id ? recallCategories(id) : []
      serverFrequent.value = id ? recallFrequent(id) : []
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
  return { categories, frequent: computed(() => serverFrequent.value), nameOf, nameById }
}
