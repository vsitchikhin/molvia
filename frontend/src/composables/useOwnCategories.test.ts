import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { SpendingCategoriesResponse, SpendingCategoryView } from '@molvia/model'
import { useOwnCategories } from '@/composables/useOwnCategories'
import { createAppI18n } from '@/i18n'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'

const spendingCategories = vi.fn<() => Promise<SpendingCategoriesResponse>>()
vi.mock('@/api', () => ({ api: { spendingCategories: () => spendingCategories() } }))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GROCERIES = 'c0000000-0000-4000-8000-000000000001'
const DOCUMENTS = 'c0000000-0000-4000-8000-000000000002'
const preset = (id: string, key: 'groceries' | 'documents'): SpendingCategoryView => ({
  id,
  preset: key,
  name: null,
  colour: null,
  icon: null,
  archived: false,
})
const CATEGORIES = [preset(GROCERIES, 'groceries'), preset(DOCUMENTS, 'documents')]

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  spendingCategories.mockReset()
})
afterEach(() => {
  document.body.innerHTML = ''
})

function host() {
  let frequent: () => readonly string[] = () => []
  const Host = defineComponent({
    setup() {
      const own = useOwnCategories()
      frequent = () => own.frequent.value
      return () => h('div')
    },
  })
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  const view = mount(Host, { global: { plugins: [pinia, createAppI18n('en')] } })
  return { view, frequent: () => frequent(), queue: useSpendingQueueStore() }
}

// The owner's categories away from «Деньги» — an account's screen, its check, «не попали» — and the
// chips' frequency with them (MOL-198, adversarial А3): asked when the screen comes up, and again on
// every write of the queue that lands, as «Деньги» read their month again on it.
describe('useOwnCategories', () => {
  it('asks the frequency again when a spending lands', async () => {
    spendingCategories.mockResolvedValueOnce({ categories: CATEGORIES, frequent: [GROCERIES] })
    spendingCategories.mockResolvedValue({
      categories: CATEGORIES,
      frequent: [DOCUMENTS, GROCERIES],
    })
    const { view, frequent, queue } = host()
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(1)
    expect(frequent()).toEqual([GROCERIES])

    queue.landed += 1
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(2)
    expect(frequent()).toEqual([DOCUMENTS, GROCERIES])
    view.unmount()
  })

  it('must not fire: nothing landed, nothing asked again', async () => {
    spendingCategories.mockResolvedValue({ categories: CATEGORIES, frequent: [GROCERIES] })
    const { view } = host()
    await flushPromises()
    await flushPromises()
    expect(spendingCategories).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})
