import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type {
  SpendingCategoriesResponse,
  SpendingCategoryBody,
  SpendingCategoryView,
} from '@molvia/model'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import MoneyCategoriesView from './MoneyCategoriesView.vue'

const spendingCategories = vi.fn<() => Promise<SpendingCategoriesResponse>>()
const addSpendingCategory =
  vi.fn<(body: SpendingCategoryBody) => Promise<SpendingCategoriesResponse>>()
const archiveSpendingCategory = vi.fn<(id: string) => Promise<SpendingCategoriesResponse>>()
const restoreSpendingCategory = vi.fn<(id: string) => Promise<SpendingCategoriesResponse>>()
vi.mock('@/api', () => ({
  api: {
    spendingCategories: () => spendingCategories(),
    addSpendingCategory: (body: SpendingCategoryBody) => addSpendingCategory(body),
    archiveSpendingCategory: (id: string) => archiveSpendingCategory(id),
    restoreSpendingCategory: (id: string) => restoreSpendingCategory(id),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'
const GROCERIES = 'ffffffff-0000-4000-8000-000000000001'
const CAFE = 'ffffffff-0000-4000-8000-000000000002'
const HEALTH = 'ffffffff-0000-4000-8000-000000000008'
const OWN = 'ffffffff-0000-4000-8000-000000000020'

const preset = (id: string, key: string, archived = false): SpendingCategoryView => ({
  id,
  preset: key as 'groceries',
  name: null,
  colour: null,
  archived,
})
const own = (id: string, name: string, archived = false): SpendingCategoryView => ({
  id,
  preset: null,
  name,
  colour: 0,
  archived,
})

const LIST: SpendingCategoryView[] = [
  preset(GROCERIES, 'groceries'),
  preset(CAFE, 'cafe'),
  own(OWN, 'Armenian lessons'),
  preset(HEALTH, 'health', true),
]

const views: VueWrapper[] = []
async function render(): Promise<VueWrapper> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const actor = useActorStore()
  actor.id = ACTOR
  actor.state = 'ready'
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money/categories')
  const view = mount(MoneyCategoriesView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n('en')] },
  })
  views.push(view)
  await flushPromises()
  return view
}

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

let clock = 0

/** Waits for a sheet to rise — until then it takes no tap. */
async function risen(): Promise<void> {
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
}

function sheetButton(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('dialog[open] button')].find(
    (button) => button.textContent.trim() === text,
  )
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no «${text}» in the sheet`)
  return found
}

/** What stands in the strip over the tab bar. */
function strip(view: VueWrapper): string[] {
  return view.findAll('.screen > .dock button').map((button) => button.text())
}

function addButton(view: VueWrapper) {
  return view
    .findAll('.screen > .dock button')
    .find((button) => button.text() === en.spending.categories.add)
}

/** «Добавить категорию» → the sheet → a name → «Добавить». */
async function addThroughSheet(view: VueWrapper, name: string): Promise<void> {
  await addButton(view)?.trigger('click')
  await risen()
  const input = document.querySelector<HTMLInputElement>('dialog[open] input')
  if (!input) throw new Error('no field')
  input.value = name
  input.dispatchEvent(new Event('input'))
  await flushPromises()
  sheetButton(en.spending.new_category.save).click()
  await flushPromises()
}

beforeEach(() => {
  vi.restoreAllMocks()
  for (const mock of [
    spendingCategories,
    addSpendingCategory,
    archiveSpendingCategory,
    restoreSpendingCategory,
  ]) {
    mock.mockReset()
  }
  localStorage.clear()
  sessionStorage.clear()
  online(true)
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})
afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

describe('MoneyCategoriesView: «Добавить категорию» in the strip (MOL-191, Ф-28)', () => {
  it('stands in the strip, and the list has no button of its own over it', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    expect(strip(view)).toEqual([en.spending.categories.add])
    expect(view.find('.content').text()).not.toContain(en.spending.categories.add)
  })

  it('stands while the list is coming, and opens the sheet then too (7f)', async () => {
    spendingCategories.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    await addButton(view)?.trigger('click')
    await risen()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.spending.new_category.title,
    )
  })

  it('must not fire: offline with no list ever shown, there is no strip (7h)', async () => {
    online(false)
    spendingCategories.mockRejectedValue(new TypeError('network'))
    const view = await render()
    expect(view.text()).toContain(en.spending.categories.offline.body)
    expect(view.find('.screen > .dock').exists()).toBe(false)
  })

  it('an error takes the strip for «Try again», and the answer gives it back', async () => {
    spendingCategories.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL))
    const view = await render()
    expect(view.text()).toContain(en.spending.categories.load_error.title)
    expect(strip(view)).toContain(en.state.retry)
    expect(addButton(view)).toBeUndefined()

    spendingCategories.mockResolvedValue({ categories: LIST })
    await view
      .findAll('.screen > .dock button')
      .find((button) => button.text() === en.state.retry)
      ?.trigger('click')
    await flushPromises()
    expect(strip(view)).toEqual([en.spending.categories.add])
  })

  it('offline over a list shown, a category is made through the queue and waits', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    online(false)
    window.dispatchEvent(new Event('offline'))
    await flushPromises()
    expect(strip(view)).toEqual([en.spending.categories.add])

    await addThroughSheet(view, 'Gifts')
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(addSpendingCategory).not.toHaveBeenCalled()
    expect(useSpendingQueueStore().pending).toHaveLength(1)
    const row = view.findAll('li').find((one) => one.text().includes('Gifts'))
    expect(row?.text()).toContain(en.spending.pending)
  })
})

describe('MoneyCategoriesView: «Убрать» is quiet (MOL-191, Ф-34)', () => {
  it('«Remove» is a ghost, never the red one; «Bring back» stands on the removed', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    const remove = view
      .findAll('button')
      .filter((button) => button.text() === en.spending.categories.remove)
    expect(remove).toHaveLength(3)
    for (const button of remove) {
      expect(button.classes()).toContain('ghost')
      expect(button.classes()).not.toContain('danger-ghost')
    }
    expect(view.findAll('button.danger-ghost')).toHaveLength(0)
    const restore = view.findAll('button').filter((button) => button.text() === en.spending.restore)
    expect(restore).toHaveLength(1)
    expect(restore[0]?.classes()).toContain('ghost')
  })
})
