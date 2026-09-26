import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { tripViewCodec } from '@molvia/model'
import type {
  AddExpenseBody,
  CatalogueEntry,
  CatalogueSearchResponse,
  ProposedItem,
} from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import { provideAnnouncer } from '@/composables/useAnnouncer'
import { routes } from '@/router'
import { useItemEntryStore } from '@/stores/itemEntry'
import { useRecentItemsStore } from '@/stores/recentItems'
import { useTripStore } from '@/stores/trip'
import { useTripQueueStore } from '@/stores/tripQueue'
import ItemSearchView from '@/views/ItemSearchView.vue'
import { holdsTyping } from '@/pwaUpdate'

/** Rows alone are a near answer — or an empty one; a far answer is given whole (MOL-46). */
const searchCatalogue =
  vi.fn<(query: string) => Promise<CatalogueEntry[] | CatalogueSearchResponse>>()
const proposeItem =
  vi.fn<(input: ProposedItem) => Promise<{ entry: CatalogueEntry; created: boolean }>>()
const addExpense = vi.fn<(tripId: string, body: AddExpenseBody) => Promise<unknown>>()
const currentTrip = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null))
vi.mock('@/api', () => ({
  api: {
    searchCatalogue: async (query: string) => {
      const answer = await searchCatalogue(query)
      return Array.isArray(answer) ? { items: answer, near: answer.length > 0 } : answer
    },
    proposeItem: (input: ProposedItem) => proposeItem(input),
    addExpense: (tripId: string, body: AddExpenseBody) => addExpense(tripId, body),
    currentTrip: () => currentTrip(),
  },
}))

const ACTOR = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function entry(n: number, name: string, note: string | null = null): CatalogueEntry {
  return {
    id: `0b6f2c4e-8d1a-4f3b-9c7e-${String(n).padStart(12, '0')}`,
    kind: 'product',
    name,
    note,
    defaultUnit: 'l',
    typicalQuantity: null,
  }
}

const milk = entry(1, 'Молоко «Ашхар»', 'ультрапастеризованное, 2,5%')
const marianna = entry(2, 'Молоко «Марианна»')
const bread = entry(3, 'Хлеб «Гюмри»', 'формовой')

function online(value: boolean): void {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

const mounted: VueWrapper[] = []
let pinia: Pinia

/** Items the person added to trips before, as the sheet of MOL-24 will write them. */
function remembered(...items: CatalogueEntry[]): void {
  const recent = useRecentItemsStore(pinia)
  for (const item of [...items].reverse()) recent.remember(item)
}

/**
 * The screen under the app's own live region, so what it reads out can be heard. `shown` takes the
 * screen away while the region stays — what leaving it does.
 */
async function render(shown = ref(true)) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/trip/add')
  const wrapper = mount(
    defineComponent({
      setup() {
        const announcements = provideAnnouncer()
        return () =>
          h('div', [
            shown.value ? h(ItemSearchView) : null,
            h('p', { class: 'live' }, announcements.value.map((a) => a.text).join(' | ')),
          ])
      },
    }),
    { attachTo: document.body, global: { plugins: [router, pinia, createAppI18n('en')] } },
  )
  mounted.push(wrapper)
  return wrapper
}

function field(view: VueWrapper) {
  return view.get<HTMLInputElement>('input[role="combobox"]')
}

function names(view: VueWrapper): string[] {
  return view.findAll('[role="option"] .name').map((name) => name.text())
}

function button(view: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const found = view.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw new Error(`no button «${text}»`)
  return found
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('molvia.actor', ACTOR)
  pinia = createPinia()
  setActivePinia(pinia)
  searchCatalogue.mockReset()
  proposeItem.mockReset()
  online(true)
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.restoreAllMocks()
  // A sheet's close holds «a step in flight» until the pop lands, and a memory history sends no
  // `popstate`: held into the next test, it swallowed that test's step back, and a sheet there
  // never closed. The pop a browser would send, sent here.
  window.dispatchEvent(new PopStateEvent('popstate'))
})

describe('«What did you pick up?»', () => {
  it('shows the recent items under an empty field and asks the server nothing', async () => {
    remembered(bread, milk)
    const view = await render()

    expect(view.text()).toContain(en.item.group_recent)
    expect(names(view)).toEqual([bread.name, milk.name])
    expect(searchCatalogue).not.toHaveBeenCalled()
  })

  it('shows only the field and its hint on a first visit', async () => {
    const view = await render()

    expect(view.find('[role="listbox"]').exists()).toBe(false)
    expect(view.text()).not.toContain(en.item.group_recent)
    expect(view.text()).toContain(en.item.search_hint)
  })

  it('draws the skeleton until the first answer, then the rows under «Found»', async () => {
    let answer!: (entries: CatalogueEntry[]) => void
    searchCatalogue.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const view = await render()

    await field(view).setValue('молок')
    expect(view.find('.loading .bars').exists()).toBe(true)

    await vi.waitFor(() => {
      expect(searchCatalogue).toHaveBeenCalledWith('молок')
    })
    answer([milk, marianna])
    await vi.waitFor(() => {
      expect(names(view)).toEqual([milk.name, marianna.name])
    })
    expect(view.text()).toContain(en.item.group_found)
    expect(view.text()).not.toContain(en.item.group_recent)
    expect(view.find('.loading').exists()).toBe(false)
  })

  it('reads the count out once the answer is in', async () => {
    searchCatalogue.mockResolvedValue([milk, marianna])
    const view = await render()

    await field(view).setValue('молок')

    await vi.waitFor(() => {
      expect(view.get('.live').text()).toBe('Found 2 items')
    })
  })

  it('reads out that nothing was found — after «Found 1 item» silence would mean nothing happened', async () => {
    searchCatalogue.mockResolvedValueOnce([milk]).mockResolvedValueOnce([])
    const view = await render()
    await field(view).setValue('молок')
    await vi.waitFor(() => {
      expect(view.get('.live').text()).toBe('Found 1 item')
    })

    await field(view).setValue('молокоо')

    await vi.waitFor(() => {
      expect(view.get('.live').text()).toBe(en.item.empty.body.replace('{query}', 'молокоо'))
    })
  })

  describe('takes its words back when the answer they describe goes', () => {
    async function foundOne() {
      searchCatalogue.mockResolvedValueOnce([milk])
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(view.get('.live').text()).toBe('Found 1 item')
      })
      return view
    }

    it('when the field is cleared', async () => {
      const view = await foundOne()
      await field(view).setValue('')
      expect(view.get('.live').text()).toBe('')
    })

    it('when the next search fails — «found one» over an error would be a lie', async () => {
      const view = await foundOne()
      searchCatalogue.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
      await field(view).setValue('молоко')
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.error.title)
      })
      expect(view.get('.live').text()).not.toContain('Found')
    })

    it('when the screen is left', async () => {
      searchCatalogue.mockResolvedValue([milk])
      const shown = ref(true)
      const view = await render(shown)
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(view.get('.live').text()).toBe('Found 1 item')
      })

      shown.value = false
      await nextTick()

      expect(view.get('.live').text()).toBe('')
    })
  })

  it('does not read out an answer that lands in the pause — it is for the text before', async () => {
    let second!: (entries: CatalogueEntry[]) => void
    searchCatalogue
      .mockResolvedValueOnce([milk])
      .mockReturnValueOnce(new Promise((resolve) => (second = resolve)))
      .mockResolvedValue([marianna])
    const view = await render()
    await field(view).setValue('молок')
    await vi.waitFor(() => {
      expect(view.get('.live').text()).toBe('Found 1 item')
    })
    await field(view).setValue('молоко')
    await vi.waitFor(() => {
      expect(searchCatalogue).toHaveBeenCalledTimes(2)
    })

    await field(view).setValue('молоко м')
    second([milk, marianna])
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(view.get('.live').text()).toBe('')

    await vi.waitFor(() => {
      expect(view.get('.live').text()).toBe('Found 1 item')
    })
    expect(names(view)).toEqual([marianna.name])
  })

  it('names the query nothing was found for', async () => {
    searchCatalogue.mockResolvedValue([])
    const view = await render()

    await field(view).setValue('тан')

    await vi.waitFor(() => {
      expect(view.get('.not-found-text').text()).toBe(en.item.empty.body.replace('{query}', 'тан'))
    })
    expect(view.find('[role="listbox"]').exists()).toBe(false)
  })

  describe('a far answer — rows, none of them close (MOL-46)', () => {
    const tea = entry(7, 'Чай зелёный')

    async function farFor(query: string) {
      searchCatalogue.mockResolvedValue({ items: [tea], near: false })
      const view = await render()
      await field(view).setValue(query)
      await vi.waitFor(() => {
        expect(names(view)).toEqual([tea.name])
      })
      return view
    }

    it('says «not found» under the rows, with the button to suggest the item', async () => {
      const view = await farFor('пельмени')

      expect(view.get('.not-found-text').text()).toBe(
        en.item.empty.body.replace('{query}', 'пельмени'),
      )
      expect(button(view, en.item.empty.action).exists()).toBe(true)
    })

    it('puts nothing above the rows: they stay where they were as the answer flips near and far', async () => {
      // A block above the list moved every row under the finger while a word was typed — «ореш»
      // far, «орешки» near (owner's decision on review, В-2).
      const view = await farFor('пельмени')

      const html = view.html()
      expect(html.indexOf('class="not-found')).toBeGreaterThan(html.indexOf('role="listbox"'))
    })

    it('heads the rows as a likeness in spelling, not as a find', async () => {
      const view = await farFor('пельмени')

      expect(view.text()).toContain(en.item.group_similar)
      expect(view.text()).not.toContain(en.item.group_found)
    })

    it('does not add the quiet «not here?» under them — the button is already above', async () => {
      const view = await farFor('пельмени')

      expect(view.text()).not.toContain(en.item.not_listed)
    })

    it('reads out «not found» and how many look alike, not «found»', async () => {
      const view = await farFor('пельмени')

      await vi.waitFor(() => {
        expect(view.get('.live').text()).toBe(
          'Nothing found for «пельмени». 1 item with a similar spelling',
        )
      })
    })

    it('still lets a row be picked, with the query it answered', async () => {
      const view = await farFor('малако')

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: tea, query: 'малако' })
    })

    it('hands its query to a pick by another word, as a miss would (MOL-45)', async () => {
      searchCatalogue.mockImplementation((query) =>
        Promise.resolve(query === 'картофель' ? [milk] : { items: [tea], near: false }),
      )
      const view = await render()
      await field(view).setValue('овощи')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([tea.name])
      })
      await field(view).setValue('картофель')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({
        entry: milk,
        query: 'картофель',
        missedQuery: 'овощи',
      })
    })

    it('must not fire on a near answer: rows under «Found», the quiet line under them', async () => {
      searchCatalogue.mockResolvedValue([milk])
      const view = await render()
      await field(view).setValue('молоко')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })

      expect(view.find('.not-found').exists()).toBe(false)
      expect(view.text()).toContain(en.item.group_found)
      expect(view.text()).toContain(en.item.not_listed)
    })
  })

  it('holds a new version of the app off while a search is typed (MOL-46, review Е)', async () => {
    // The query and the miss live in memory only: the phone put away to ask what a thing is called
    // here must come back to them.
    searchCatalogue.mockResolvedValue([])
    const view = await render()
    expect(holdsTyping(document)).toBe(false)

    await field(view).setValue('кефир')

    expect(holdsTyping(document)).toBe(true)
  })

  it('goes back to the recent items when the field is cleared', async () => {
    remembered(bread)
    searchCatalogue.mockResolvedValue([milk])
    const view = await render()
    await field(view).setValue('молок')
    await vi.waitFor(() => {
      expect(names(view)).toEqual([milk.name])
    })

    await field(view).setValue('')

    expect(names(view)).toEqual([bread.name])
    expect(view.text()).toContain(en.item.group_recent)
  })

  describe('when the server does not answer', () => {
    it('says so and tries again on «Try again»', async () => {
      searchCatalogue.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
      searchCatalogue.mockResolvedValueOnce([milk])
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.error.title)
      })

      await button(view, en.state.retry).trigger('click')

      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })
      expect(searchCatalogue).toHaveBeenCalledTimes(2)
    })

    it('hands over the recent items when asked, so the trip goes on', async () => {
      remembered(bread, milk)
      searchCatalogue.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.error.title)
      })
      expect(view.find('[role="listbox"]').exists()).toBe(false)

      await button(view, en.item.error.fallback).trigger('click')

      // Narrowed by what was typed, as offline (Р-12): the bread is not what «молок» asked for.
      expect(names(view)).toEqual([milk.name])
      expect(view.text()).toContain(en.item.error.title)
    })

    it('offers no «Pick from recent» when there are none to pick', async () => {
      searchCatalogue.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.error.title)
      })

      expect(view.text()).not.toContain(en.item.error.fallback)
      expect(view.text()).toContain(en.state.retry)
    })

    it('keeps the recent items taken when the app is looked at again and the server is still down', async () => {
      remembered(milk)
      searchCatalogue.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'HTTP 500'))
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.error.title)
      })
      await button(view, en.item.error.fallback).trigger('click')

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledTimes(2)
      })
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(names(view)).toEqual([milk.name])
      expect(view.text()).not.toContain(en.item.error.fallback)
    })
  })

  describe('offline', () => {
    it('says so in warning, not in red, and searches the recent items as typed', async () => {
      remembered(bread, milk, marianna)
      online(false)
      const view = await render()

      await field(view).setValue('молоко')

      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.offline.title)
      })
      expect(view.find('.tone-bad').exists()).toBe(false)
      expect(names(view)).toEqual([milk.name, marianna.name])
      expect(searchCatalogue).not.toHaveBeenCalled()
    })

    it('shows nothing under the notice when no recent item matches', async () => {
      remembered(bread)
      online(false)
      const view = await render()

      await field(view).setValue('молоко')

      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.offline.title)
      })
      expect(view.find('[role="listbox"]').exists()).toBe(false)
    })
  })

  describe('a pick', () => {
    it('leaves with the query exactly as typed', async () => {
      searchCatalogue.mockResolvedValue([milk, marianna])
      const view = await render()
      await field(view).setValue(' Мол ')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(2)
      })

      await view.findAll('[role="option"]')[1]?.trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: marianna, query: ' Мол ' })
    })

    it('takes along the query that found nothing before — the person’s own word for it (MOL-45)', async () => {
      searchCatalogue.mockImplementation((query) =>
        Promise.resolve(query === 'арбуз' ? [milk] : []),
      )
      const view = await render()
      await field(view).setValue('бахчевые')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('бахчевые')
      })
      await field(view).setValue('арбуз')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({
        entry: milk,
        query: 'арбуз',
        missedQuery: 'бахчевые',
      })
    })

    it('takes nothing along when the pick is the same query cut short: «сыр косичка», then «сыр» (review Р-1)', async () => {
      searchCatalogue.mockImplementation((query) => Promise.resolve(query === 'сыр' ? [milk] : []))
      const view = await render()
      await field(view).setValue('сыр косичка')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('сыр косичка')
      })
      await field(view).setValue('сыр')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: 'сыр' })
    })

    it('takes nothing along from the recent items — they were not found by another word', async () => {
      searchCatalogue.mockResolvedValue([])
      remembered(bread)
      const view = await render()
      await field(view).setValue('бахчевые')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('бахчевые')
      })
      await field(view).setValue('')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([bread.name])
      })

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: bread, query: '' })
    })

    it('from a dimmed answer leaves with the query that answer is for, not the one being typed', async () => {
      let second!: (entries: CatalogueEntry[]) => void
      searchCatalogue
        .mockResolvedValueOnce([milk])
        .mockReturnValueOnce(new Promise((resolve) => (second = resolve)))
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })
      await field(view).setValue('хлеб')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledTimes(2)
      })
      expect(view.get('[role="listbox"]').classes()).toContain('stale')

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: 'молок' })
      second([bread])
    })

    it('from the recent items offline leaves with the field as typed', async () => {
      remembered(milk)
      online(false)
      const view = await render()
      await field(view).setValue('мол')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: 'мол' })
    })

    it('from the recent items leaves with the empty query it was made on', async () => {
      remembered(bread)
      const view = await render()

      await view.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: bread, query: '' })
    })

    it('does not write the recent items — that is for adding to a trip, not for a tap', async () => {
      searchCatalogue.mockResolvedValue([milk])
      const view = await render()
      await field(view).setValue('молок')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(1)
      })

      await view.get('[role="option"]').trigger('click')

      expect(useRecentItemsStore(pinia).items).toEqual([])
    })
  })

  describe('«Suggest an item»', () => {
    // The sheet takes no tap while it rises (MOL-18): its clock is held by the test and moved
    // past that moment, and a few real milliseconds pass so Vue does not drop the tap.
    async function sheetRisen(): Promise<void> {
      vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    it('is offered when nothing was found, and what it adds is picked with the query', async () => {
      const tan = entry(9, 'Тан')
      searchCatalogue.mockResolvedValue([])
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      vi.spyOn(performance, 'now').mockReturnValue(0)
      const view = await render()
      await field(view).setValue('тан')
      await vi.waitFor(() => {
        expect(view.find('.not-found').exists()).toBe(true)
      })

      await button(view, en.item.empty.action).trigger('click')
      await sheetRisen()
      const name = view.get<HTMLInputElement>('dialog input[type="text"]')
      expect(name.element.value).toBe('тан')
      const litre = view
        .findAll('dialog label')
        .find((label) => label.text() === en.item.unit_l)
        ?.find('input')
      await litre?.setValue(true)
      await button(view, en.item.propose.submit).trigger('click')

      await vi.waitFor(() => {
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: tan, query: 'тан' })
      })
    })

    it('is a quiet line under an answer that has rows — the answer may still not be the thing', async () => {
      searchCatalogue.mockResolvedValue([milk])
      const view = await render()
      await field(view).setValue('сметана')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(1)
      })

      const line = button(view, en.item.not_listed)
      expect(view.html().indexOf(en.item.not_listed)).toBeGreaterThan(
        view.html().indexOf('role="listbox"'),
      )
      expect(line.classes().join(' ')).toContain('ghost')
    })

    it('learns nothing from a miss before it — what is proposed was not found by another word (review З)', async () => {
      const tan = entry(9, 'Тан')
      searchCatalogue.mockImplementation((query) => Promise.resolve(query === 'тан' ? [milk] : []))
      proposeItem.mockResolvedValue({ entry: tan, created: true })
      vi.spyOn(performance, 'now').mockReturnValue(0)
      const view = await render()
      await field(view).setValue('кефир')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('кефир')
      })
      await field(view).setValue('тан')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(1)
      })

      await button(view, en.item.not_listed).trigger('click')
      await sheetRisen()
      const litre = view
        .findAll('dialog label')
        .find((label) => label.text() === en.item.unit_l)
        ?.find('input')
      await litre?.setValue(true)
      await button(view, en.item.propose.submit).trigger('click')

      await vi.waitFor(() => {
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: tan, query: 'тан' })
      })
    })

    it('is not offered under the recent items: they are not an answer to anything', async () => {
      remembered(bread)
      const view = await render()

      expect(view.text()).not.toContain(en.item.not_listed)
      expect(view.text()).not.toContain(en.item.empty.action)
    })
  })

  describe('the sheet «how much, for what price» (MOL-24)', () => {
    const TRIP = 'bbbbbbbb-0000-4000-8000-000000000001'

    function onTrip(): void {
      const trip = tripViewCodec.parse({
        id: TRIP,
        startedAt: '2026-09-19T08:00:00.000Z',
        finishedAt: null,
        currency: 'AMD',
        rate: null,
        rateProvider: null,
        rateJump: null,
        rateStale: false,
        place: {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          kind: 'store',
          name: 'Ереван Сити',
        },
        expenses: [],
        total: [],
        converted: null,
      })
      useTripStore(pinia).apply(trip)
      // The sheet asks the server each time it opens; the server knows the same trip.
      currentTrip.mockResolvedValue(trip)
    }

    async function picked(view: VueWrapper): Promise<void> {
      await view.get('[role="option"]').trigger('click')
      // Past the moment the sheet rises: until then it takes no tap.
      vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
      await new Promise((resolve) => setTimeout(resolve, 5))
    }

    beforeEach(() => {
      addExpense.mockReset()
      addExpense.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
      vi.spyOn(performance, 'now').mockReturnValue(0)
      onTrip()
    })

    it('comes up over the screen on a pick', async () => {
      remembered(milk)
      const view = await render()
      await picked(view)

      const sheet = view.get('dialog[open]')
      expect(sheet.text()).toContain(milk.name)
      expect(sheet.text()).toContain(en.item.save)
    })

    it('adds with the query of the search, and only then remembers the item', async () => {
      searchCatalogue.mockResolvedValue([milk])
      const view = await render()
      await field(view).setValue('мол')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(1)
      })
      await picked(view)

      const add = view.findAll('dialog[open] button').find((b) => b.text() === en.item.save)
      await add?.trigger('click')

      const [write] = useTripQueueStore(pinia).pending
      expect(write).toMatchObject({ kind: 'add', tripId: TRIP, entry: milk })
      if (write?.kind === 'add') expect(write.body.query).toBe('мол')
      expect(useRecentItemsStore(pinia).items).toEqual([milk])
    })

    it('lets only the first sheet after a miss take it along: put back, the miss is gone (review И)', async () => {
      searchCatalogue.mockImplementation((query) =>
        Promise.resolve(query === 'кефир' ? [] : [milk, marianna]),
      )
      const view = await render()
      await field(view).setValue('кефир')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('кефир')
      })
      await field(view).setValue('молоко')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(2)
      })
      const store = useItemEntryStore(pinia)

      await picked(view)
      expect(store.picked?.missedQuery).toBe('кефир')
      await view.get(`dialog[open] button[aria-label="${en.sheet.close}"]`).trigger('click')
      await vi.waitFor(() => {
        expect(store.picked).toBeNull()
      })
      await view.findAll('[role="option"]')[1]?.trigger('click')

      expect(store.picked?.missedQuery).toBeUndefined()
    })

    it('writes nothing, not even the recent items, when closed with ×', async () => {
      remembered(bread)
      searchCatalogue.mockResolvedValue([milk])
      const view = await render()
      await field(view).setValue('мол')
      await vi.waitFor(() => {
        expect(names(view)).toHaveLength(1)
      })
      await picked(view)

      await view.get(`dialog[open] button[aria-label="${en.sheet.close}"]`).trigger('click')

      expect(useTripQueueStore(pinia).pending).toEqual([])
      expect(useRecentItemsStore(pinia).items).toEqual([bread])
    })
  })
})
