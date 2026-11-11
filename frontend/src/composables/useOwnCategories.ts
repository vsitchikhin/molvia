import { computed, onMounted, ref, watch } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import { spendingCategoriesResponseCodec } from '@molvia/model'
import type { SpendingCategoriesResponse, SpendingCategoryView } from '@molvia/model'
import { api } from '@/api'
import { categoriesWith } from '@/components/spending'
import { recallKeptList } from '@/composables/useMoneyMonth'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import { read, write } from '@/stores/storage'

/**
 * The list as the server last answered it here (MOL-400, adversarial А3 «б»): a trip's category is chosen at the
 * shelf with no connection, on a phone where «Деньги» — the other memory of the list — may never have been
 * opened. `molvia.own-categories.<owner>`, gone with «Выйти» as the owner's other drawers; kept with when its read
 * set out, since a month of «Деньги» read later names a category made there since (adversarial Б1).
 */
const KEY = 'molvia.own-categories'
const keptCodec = z.object({ askedAt: z.iso.datetime(), answer: spendingCategoriesResponseCodec })

function recallOwn(owner: string): { answer: SpendingCategoriesResponse; askedAt: Date } | null {
  const raw = read(`${KEY}.${owner}`)
  if (!raw) return null
  try {
    const parsed = keptCodec.safeParse(JSON.parse(raw))
    return parsed.success
      ? { answer: parsed.data.answer, askedAt: new Date(parsed.data.askedAt) }
      : null
  } catch {
    return null
  }
}

/** The later of the two lists the phone keeps: this one's, or the newest month's of «Деньги». */
function keptList(owner: string): SpendingCategoriesResponse {
  const own = recallOwn(owner)
  const month = recallKeptList(owner)
  if (own && (!month || own.askedAt.getTime() >= month.askedAt.getTime())) return own.answer
  return { categories: month?.categories ?? [], frequent: month?.frequent ?? [] }
}

export interface OwnCategories {
  readonly categories: ComputedRef<SpendingCategoryView[]>
  /** The ids the chips of a spending stand first by (MOL-198), of the same answer. */
  readonly frequent: ComputedRef<readonly string[]>
  readonly nameOf: (category: SpendingCategoryView) => string
  /** The category's name by its id, «Прочее» when the phone does not know it. */
  readonly nameById: (id: string | null) => string
  /** Asks the server for the list; a lazy one asks only so. */
  readonly refresh: () => Promise<void>
}

/**
 * The owner's categories away from the month (MOL-123): the journal of an account, «не попали» and
 * the check name and draw a spending by its category, and a spending opened there is amended in the
 * sheet of «Деньги». They are the owner's, not a month's: any month kept on the phone names them,
 * and the server's list is asked once the screen is up, and again whenever a write of the queue lands
 * — with the ones waiting in the queue on top. **Lazy** asks only by `refresh` (MOL-400, review №6): a screen that
 * needs the list for one sheet reads it as the sheet opens, never with every opening of the screen.
 */
export function useOwnCategories(options: { readonly lazy?: boolean } = {}): OwnCategories {
  const { t } = useI18n()
  const actor = useActorStore()
  const queue = useSpendingQueueStore()
  const kept = actor.id ? keptList(actor.id) : null
  const server = ref<SpendingCategoryView[]>(kept?.categories ?? [])
  const serverFrequent = ref<readonly string[]>(kept?.frequent ?? [])
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
      const answer = await api.spendingCategories()
      const { categories, frequent } = answer
      if (actor.id !== owner || mine < laid) return
      laid = mine
      const encoded = spendingCategoriesResponseCodec.encode(answer)
      write(`${KEY}.${owner}`, JSON.stringify({ askedAt: asked.toISOString(), answer: encoded }))
      server.value = categories
      serverFrequent.value = frequent
      askedAt.value = asked
    } catch {
      // Whatever the phone remembers stands; a name unknown reads «Прочее».
    }
  }
  if (!options.lazy) {
    onMounted(() => void load())
    // A spending landed moves the chips' frequency, as «Деньги» read their month again on it (MOL-198,
    // adversarial А3): the next sheet on an account's screen stands its chips by the order after it.
    watch(
      () => queue.landed,
      () => void load(),
    )
  }
  watch(
    () => actor.id,
    (id) => {
      const list = id ? keptList(id) : null
      server.value = list?.categories ?? []
      serverFrequent.value = list?.frequent ?? []
      askedAt.value = null
      if (!options.lazy) void load()
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
  return {
    categories,
    frequent: computed(() => serverFrequent.value),
    nameOf,
    nameById,
    refresh: load,
  }
}
