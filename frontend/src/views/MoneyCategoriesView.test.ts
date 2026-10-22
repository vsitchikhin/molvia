import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import type {
  SpendingCategoriesResponse,
  SpendingCategoryAmend,
  SpendingCategoryBody,
  SpendingCategoryView,
} from '@molvia/model'
import ListRow from '@/components/ListRow.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'
import { useActorStore } from '@/stores/actor'
import { useSpendingQueueStore } from '@/stores/spendingQueue'
import MoneyCategoriesView from './MoneyCategoriesView.vue'

const spendingCategories = vi.fn<() => Promise<SpendingCategoriesResponse>>()
const addSpendingCategory =
  vi.fn<(body: SpendingCategoryBody) => Promise<SpendingCategoriesResponse>>()
const amendSpendingCategory =
  vi.fn<(id: string, body: SpendingCategoryAmend) => Promise<SpendingCategoriesResponse>>()
const archiveSpendingCategory = vi.fn<(id: string) => Promise<SpendingCategoriesResponse>>()
const restoreSpendingCategory = vi.fn<(id: string) => Promise<SpendingCategoriesResponse>>()
vi.mock('@/api', () => ({
  api: {
    spendingCategories: () => spendingCategories(),
    addSpendingCategory: (body: SpendingCategoryBody) => addSpendingCategory(body),
    amendSpendingCategory: (id: string, body: SpendingCategoryAmend) =>
      amendSpendingCategory(id, body),
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
  icon: null,
  archived,
})
const own = (id: string, name: string, archived = false): SpendingCategoryView => ({
  id,
  preset: null,
  name,
  colour: 0,
  icon: 'tag',
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
    amendSpendingCategory,
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

  it('must not fire: no strip under the skeleton, so no sheet without the list (В-2 «а»)', async () => {
    let answer: (value: SpendingCategoriesResponse) => void = () => undefined
    spendingCategories.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const view = await render()
    expect(view.find('.skeleton').exists()).toBe(true)
    expect(view.find('.screen > .dock').exists()).toBe(false)

    answer({ categories: LIST })
    await flushPromises()
    expect(strip(view)).toEqual([en.spending.categories.add])
  })

  it('one’s own name is refused in the sheet, never sent: the sheet opens over the list', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    await addThroughSheet(view, 'Armenian lessons')
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.spending.new_category.bad_taken,
    )
    expect(addSpendingCategory).not.toHaveBeenCalled()
    expect(useSpendingQueueStore().pending).toHaveLength(0)
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
    // The presets' only: one's own is taken out from its sheet (MOL-285).
    expect(remove).toHaveLength(2)
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

describe('MoneyCategoriesView: a row is the kit’s ListRow (MOL-191, MOL-175)', () => {
  it('a preset and a removed one are rows with «Remove» or «Bring back» in the tail; one’s own opens', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    const rows = view.findAllComponents(ListRow)
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.find('.circle').exists()).toBe(true)
      expect(row.classes()).toContain('wrap')
    }
    const [groceries, cafe, mine, health] = rows
    for (const row of [groceries, cafe, health]) {
      expect(row?.element.tagName).toBe('DIV')
      expect(row?.find('.tail button').exists()).toBe(true)
      expect(row?.find('.chevron').exists()).toBe(false)
    }
    expect(mine?.element.tagName).toBe('BUTTON')
    expect(mine?.find('.chevron').exists()).toBe(true)
    expect(mine?.find('.tail').exists()).toBe(false)
    expect(groceries?.find('.circle').attributes('style')).toContain('var(--cat-groceries)')
    expect(mine?.find('.circle').attributes('style')).toContain('var(--cat-own-0)')
  })

  it('three groups: the presets, one’s own, the removed — each only when it has a row (MOL-285)', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    expect(view.findAll('.section-caption').map((caption) => caption.text())).toEqual([
      en.spending.categories.presets,
      en.spending.categories.own_group,
      en.spending.categories.archived,
    ])
    const groups = view.findAll('.group')
    expect(groups[1]?.text()).toContain('Armenian lessons')
    expect(groups[0]?.text()).not.toContain('Armenian lessons')

    spendingCategories.mockResolvedValue({ categories: [preset(GROCERIES, 'groceries')] })
    const presetsOnly = await render()
    expect(presetsOnly.findAll('.section-caption').map((caption) => caption.text())).toEqual([
      en.spending.categories.presets,
    ])
  })

  it('«Sending…» is a tag on the category that waits, and on no other row', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    online(false)
    await addThroughSheet(view, 'Gifts')
    const tagged = view
      .findAllComponents(ListRow)
      .filter((row) => row.text().includes(en.spending.pending))
    expect(tagged).toHaveLength(1)
    expect(tagged[0]?.text()).toContain('Gifts')
    expect(tagged[0]?.find('.below .tag.warn').exists()).toBe(true)
  })

  it('a long name of one’s own is the row’s whole title, and the row wraps it', async () => {
    const long = 'Lessons of Armenian with a teacher at home'.slice(0, 40)
    spendingCategories.mockResolvedValue({ categories: [own(OWN, long)] })
    const view = await render()
    const row = view.getComponent(ListRow)
    expect(row.find('.title').text()).toBe(long)
    expect(row.classes()).toContain('wrap')
  })

  it('no removed category, no group; the last brought back takes the group away', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST.filter((one) => !one.archived) })
    const none = await render()
    expect(none.text()).not.toContain(en.spending.categories.archived)

    spendingCategories.mockResolvedValue({ categories: LIST })
    const one = await render()
    expect(one.text()).toContain(en.spending.categories.archived)
    const restored = LIST.map((category) => ({ ...category, archived: false }))
    restoreSpendingCategory.mockResolvedValue({ categories: restored })
    spendingCategories.mockResolvedValue({ categories: restored })
    await one
      .findAll('button')
      .find((button) => button.text() === en.spending.restore)
      ?.trigger('click')
    await flushPromises()
    expect(one.text()).not.toContain(en.spending.categories.archived)
    expect(one.findAllComponents(ListRow)).toHaveLength(4)
  })

  it('a refused category stands over the lists; a refused spending is not this screen’s', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    const queue = useSpendingQueueStore()
    queue.rejected = [
      {
        key: 'k1',
        write: { kind: 'category-add', body: { id: OWN, name: 'Gifts' } },
        code: ERROR.CONFLICT,
      },
      { key: 'k2', write: { kind: 'remove', id: CAFE }, code: ERROR.CONFLICT },
    ]
    await flushPromises()
    const notices = view.findAll('.state.inline')
    expect(notices).toHaveLength(1)
    const lists = view.get('.lists').element
    const before = notices[0]?.element.compareDocumentPosition(lists) ?? 0
    expect(before & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await notices[0]
      ?.findAll('button')
      .find((button) => button.text() === en.spending.sheet.dismiss)
      ?.trigger('click')
    await flushPromises()
    expect(view.findAll('.state.inline')).toHaveLength(0)
  })
})

describe('MoneyCategoriesView: the skeleton is the answer’s shape (MOL-191, Ф-13)', () => {
  it('a caption and a card of six rows «circle · name · button», no bare lines', async () => {
    spendingCategories.mockReturnValue(new Promise(() => undefined))
    const view = await render()
    expect(view.findAll('.skeleton-caption')).toHaveLength(1)
    const rows = view.findAll('.skeleton-rows .item')
    expect(rows).toHaveLength(6)
    for (const row of rows) expect(row.find('.circle').exists()).toBe(true)
    expect(view.find('.skeleton-rows').classes()).not.toContain('skeleton-narrow')
    expect(view.find('.skeleton-lines').exists()).toBe(false)
  })
})

describe('MoneyCategoriesView: the icon and the colour of one’s own (MOL-285)', () => {
  /** The radio of the sheet named so — an icon by its name, a colour by «Colour n of 8». */
  function radio(label: string): HTMLInputElement {
    const found = document.querySelector<HTMLInputElement>(
      `dialog[open] input[type="radio"][aria-label="${label}"]`,
    )
    if (!found) throw new Error(`no radio «${label}»`)
    return found
  }
  const checked = () =>
    [...document.querySelectorAll<HTMLInputElement>('dialog[open] input[type="radio"]')]
      .filter((input) => input.checked)
      .map((input) => input.getAttribute('aria-label'))

  async function choose(label: string): Promise<void> {
    radio(label).click()
    await flushPromises()
  }

  it('a new one starts on the tag and the palette’s next; chosen, it is made with them', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    online(false)
    await addButton(view)?.trigger('click')
    await risen()
    // One of one's own already, so the next is the second colour.
    expect(checked()).toEqual(['Colour 2 of 8', en.spending.icon.tag])
    expect(document.querySelectorAll('dialog[open] input[name]').length).toBeGreaterThan(40)

    await choose(en.spending.icon.gift)
    await choose('Colour 6 of 8')
    await addThroughSheetName('Gifts')
    expect(useSpendingQueueStore().pending).toMatchObject([
      { kind: 'category-add', body: { name: 'Gifts', icon: 'gift', colour: 5 } },
    ])
    const row = view.findAllComponents(ListRow).find((one) => one.text().includes('Gifts'))
    expect(row?.find('.circle').attributes('style')).toContain('var(--cat-own-5)')
  })

  it('a preset’s icon is in the choice, under the preset’s name (В-3 «б»)', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    await addButton(view)?.trigger('click')
    await risen()
    expect(radio(en.spending.category.cafe).value).toBe('cafe')
  })

  it('one’s own opens its sheet as it is; saved, the amendment goes through the queue', async () => {
    const mine = { ...own(OWN, 'Armenian lessons'), icon: 'study' as const, colour: 2 }
    spendingCategories.mockResolvedValue({ categories: [preset(GROCERIES, 'groceries'), mine] })
    const view = await render()
    online(false)
    await view.findAll('button.list-row').at(0)?.trigger('click')
    await risen()
    expect(document.querySelector('dialog[open]')?.textContent).toContain(
      en.spending.new_category.edit_title,
    )
    expect(
      document.querySelector<HTMLInputElement>('dialog[open] input:not([type="radio"])')?.value,
    ).toBe('Armenian lessons')
    expect(checked()).toEqual(['Colour 3 of 8', en.spending.icon.study])

    await choose(en.spending.icon.languages)
    sheetButton(en.spending.new_category.edit_save).click()
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(useSpendingQueueStore().pending).toEqual([
      {
        kind: 'category-amend',
        id: OWN,
        body: { name: 'Armenian lessons', icon: 'languages', colour: 2 },
      },
    ])
    const row = view.findAllComponents(ListRow).find((one) => one.text().includes('Armenian'))
    expect(row?.text()).toContain(en.spending.pending)
  })

  it('must not fire: saved as it was, nothing is written', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    await view.findAll('button.list-row').at(0)?.trigger('click')
    await risen()
    sheetButton(en.spending.new_category.edit_save).click()
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(useSpendingQueueStore().pending).toEqual([])
    expect(amendSpendingCategory).not.toHaveBeenCalled()
  })

  it('renamed to another of one’s own or to a preset, it is refused in the sheet; its own name is not', async () => {
    const second = own('ffffffff-0000-4000-8000-000000000021', 'Taxi')
    spendingCategories.mockResolvedValue({ categories: [...LIST, second] })
    const view = await render()
    online(false)
    await view.findAll('button.list-row').at(0)?.trigger('click')
    await risen()
    for (const taken of [' taxi ', en.spending.category.cafe]) {
      await typeName(taken)
      sheetButton(en.spending.new_category.edit_save).click()
      await flushPromises()
      expect(document.querySelector('dialog[open]')?.textContent).toContain(
        en.spending.new_category.bad_taken,
      )
    }
    await typeName('ARMENIAN LESSONS')
    sheetButton(en.spending.new_category.edit_save).click()
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(useSpendingQueueStore().pending).toMatchObject([
      { kind: 'category-amend', body: { name: 'ARMENIAN LESSONS' } },
    ])
  })

  it('«Take out the category» is quiet, in the sheet, and puts it among the removed', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    online(false)
    await view.findAll('button.list-row').at(0)?.trigger('click')
    await risen()
    const remove = sheetButton(en.spending.new_category.remove)
    expect(remove.classList).toContain('ghost')
    remove.click()
    await flushPromises()
    expect(document.querySelector('dialog[open]')).toBeNull()
    expect(useSpendingQueueStore().pending).toEqual([{ kind: 'category-archive', id: OWN }])
    expect(view.findAll('.group').at(-1)?.text()).toContain('Armenian lessons')
  })

  it('must not fire: a new one has no «Take out»', async () => {
    spendingCategories.mockResolvedValue({ categories: LIST })
    const view = await render()
    await addButton(view)?.trigger('click')
    await risen()
    expect(() => sheetButton(en.spending.new_category.remove)).toThrow()
  })
})

/** Types into the open sheet's name. */
async function typeName(name: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('dialog[open] input:not([type="radio"])')
  if (!input) throw new Error('no field')
  input.value = name
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

/** A name into the sheet already open, then «Добавить». */
async function addThroughSheetName(name: string): Promise<void> {
  await typeName(name)
  sheetButton(en.spending.new_category.save).click()
  await flushPromises()
}
