/* eslint-disable vue/one-component-per-file -- the scanner's stub and the harness, not components of the app */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { ApiError } from '@molvia/client'
import type { CatalogueWrite } from '@molvia/client'
import { ERROR } from '@molvia/model'
import { tripViewCodec } from '@molvia/model'
import type {
  AddExpenseBody,
  AppLocale,
  BarcodeHint,
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
const proposeItem = vi.fn<(input: ProposedItem) => Promise<CatalogueWrite>>()
const attachBarcode = vi.fn<(itemId: string, code: string) => Promise<CatalogueWrite>>()
const detachBarcode = vi.fn<(itemId: string, code: string) => Promise<void>>()
const addExpense = vi.fn<(tripId: string, body: AddExpenseBody) => Promise<unknown>>()
const currentTrip = vi.fn<() => Promise<unknown>>(() => Promise.resolve(null))
const catalogueByBarcode = vi.fn<(code: string) => Promise<CatalogueEntry | null>>()
const catalogueBarcodeHint =
  vi.fn<(code: string, locale: AppLocale) => Promise<BarcodeHint | null>>()
vi.mock('@/api', () => ({
  api: {
    catalogueByBarcode: (code: string) => catalogueByBarcode(code),
    catalogueBarcodeHint: (code: string, locale: AppLocale) => catalogueBarcodeHint(code, locale),
    searchCatalogue: async (query: string) => {
      const answer = await searchCatalogue(query)
      return Array.isArray(answer) ? { items: answer, near: answer.length > 0 } : answer
    },
    proposeItem: (input: ProposedItem) => proposeItem(input),
    attachBarcode: (itemId: string, code: string) => attachBarcode(itemId, code),
    detachBarcode: (itemId: string, code: string) => detachBarcode(itemId, code),
    addExpense: (tripId: string, body: AddExpenseBody) => addExpense(tripId, body),
    currentTrip: () => currentTrip(),
    // «Тут дешевле» on the purchase sheet (MOL-92): never answered here.
    ownPrices: () => new Promise(() => undefined),
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

/**
 * The scanner as the screen sees it: open, a code read, put away (MOL-99). The camera and its
 * worker are MOL-98's and happy-dom has neither; what the screen does with a code is this task's.
 */
const ScannerStub = defineComponent({
  name: 'BarcodeScannerSheet',
  props: {
    open: { type: Boolean, required: true },
    onClosed: { type: Function, default: undefined },
  },
  emits: ['update:open', 'read'],
  setup(props) {
    return () => (props.open ? h('div', { class: 'scanner' }) : null)
  },
})

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
    {
      attachTo: document.body,
      global: {
        plugins: [router, pinia, createAppI18n('en')],
        stubs: { BarcodeScannerSheet: ScannerStub },
      },
    },
  )
  mounted.push(wrapper)
  return wrapper
}

function field(view: VueWrapper) {
  return view.get<HTMLInputElement>('input[role="combobox"]')
}

function names(view: VueWrapper): string[] {
  return view.findAll('[role="option"] .title').map((name) => name.text())
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
  attachBarcode.mockReset()
  detachBarcode.mockReset()
  catalogueByBarcode.mockReset()
  catalogueBarcodeHint.mockReset()
  catalogueBarcodeHint.mockResolvedValue(null)
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

  describe('a reload in the middle of a search (MOL-46, review Ж)', () => {
    /** The page torn down without unmounting — what `location.reload()` does — and opened anew. */
    async function reloaded(): Promise<VueWrapper> {
      const kept = Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index) ?? ''
        return [key, sessionStorage.getItem(key) ?? ''] as const
      })
      for (const wrapper of mounted.splice(0)) wrapper.unmount()
      for (const [key, value] of kept) sessionStorage.setItem(key, value)
      pinia = createPinia()
      setActivePinia(pinia)
      return render()
    }

    it('comes back to the query typed, and does not hold the update off for it', async () => {
      searchCatalogue.mockResolvedValue([])
      const view = await render()
      await field(view).setValue('кефир')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('кефир')
      })
      expect(holdsTyping(document)).toBe(false)

      const again = await reloaded()

      expect(field(again).element.value).toBe('кефир')
    })

    it('keeps the miss through an erased field, so the next pick still teaches the word (Ж1)', async () => {
      searchCatalogue.mockImplementation((query) =>
        Promise.resolve(query === 'мацони' ? [milk] : []),
      )
      const view = await render()
      await field(view).setValue('кефир')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('кефир')
      })
      await field(view).setValue('')

      const again = await reloaded()
      await field(again).setValue('мацони')
      await vi.waitFor(() => {
        expect(names(again)).toEqual([milk.name])
      })
      await again.get('[role="option"]').trigger('click')

      expect(useItemEntryStore(pinia).picked).toEqual({
        entry: milk,
        query: 'мацони',
        missedQuery: 'кефир',
      })
    })

    it('forgets the search when the screen is left, as it always did', async () => {
      searchCatalogue.mockResolvedValue([])
      const view = await render()
      await field(view).setValue('кефир')
      view.unmount()
      mounted.splice(0)

      const next = await render()

      expect(field(next).element.value).toBe('')
    })
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

  describe('a code scanned (MOL-99)', () => {
    const CODE = '4850000000007'

    function scanner(view: VueWrapper) {
      return view.findComponent(ScannerStub)
    }

    /** The scanner opened from the field, a code read, and — unless held — the scanner put away. */
    async function scan(view: VueWrapper, code: string, away = true): Promise<void> {
      await view.get(`button[aria-label="${en.item.barcode.scan}"]`).trigger('click')
      expect(scanner(view).props('open')).toBe(true)
      scanner(view).vm.$emit('read', code)
      scanner(view).vm.$emit('update:open', false)
      await nextTick()
      if (away) putAway(view)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    /** What the sheet calls once its step back has landed. */
    function putAway(view: VueWrapper): void {
      ;(scanner(view).props('onClosed') as () => void)()
    }

    it('is offered in the field, and opens over the screen', async () => {
      const view = await render()
      expect(view.find('.scanner').exists()).toBe(false)

      await view.get(`button[aria-label="${en.item.barcode.scan}"]`).trigger('click')

      expect(view.find('.scanner').exists()).toBe(true)
    })

    it('takes the item found to the purchase sheet with no query — a code is not one', async () => {
      catalogueByBarcode.mockResolvedValue(milk)
      const view = await render()

      await scan(view, CODE)

      expect(catalogueByBarcode).toHaveBeenCalledWith(CODE)
      await vi.waitFor(() => {
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: '' })
      })
      expect(searchCatalogue).not.toHaveBeenCalled()
    })

    it('waits for the scanner to be put away before the purchase sheet comes up', async () => {
      catalogueByBarcode.mockResolvedValue(milk)
      const view = await render()

      await scan(view, CODE, false)
      expect(useItemEntryStore(pinia).picked).toBeNull()

      putAway(view)

      expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: '' })
    })

    it('uses up the miss held before it, and teaches it nothing (MOL-45)', async () => {
      searchCatalogue.mockImplementation((query) =>
        Promise.resolve(query === 'молоко' ? [milk] : []),
      )
      catalogueByBarcode.mockResolvedValue(marianna)
      const view = await render()
      await field(view).setValue('бахчевые')
      await vi.waitFor(() => {
        expect(searchCatalogue).toHaveBeenCalledWith('бахчевые')
      })

      await scan(view, CODE)
      expect(useItemEntryStore(pinia).picked).toEqual({ entry: marianna, query: '' })

      useItemEntryStore(pinia).clear()
      await field(view).setValue('молоко')
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })
      await view.get('[role="option"]').trigger('click')
      expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: 'молоко' })
    })

    it('names a code nobody holds, offers «Suggest an item», and says so out loud', async () => {
      remembered(bread)
      catalogueByBarcode.mockResolvedValue(null)
      const view = await render()

      await scan(view, CODE)

      const missing = en.item.barcode.missing.replace('{code}', CODE)
      await vi.waitFor(() => {
        expect(view.text()).toContain(missing)
      })
      expect(names(view)).toEqual([])
      expect(button(view, en.item.empty.action).exists()).toBe(true)
      await vi.waitFor(() => {
        expect(view.get('.live').text()).toBe(missing)
      })
      expect(useItemEntryStore(pinia).picked).toBeNull()
    })

    it('gives the search back once something is typed, and takes its words back', async () => {
      catalogueByBarcode.mockResolvedValue(null)
      searchCatalogue.mockResolvedValue([milk])
      const view = await render()
      await scan(view, CODE)
      const missing = en.item.barcode.missing.replace('{code}', CODE)
      await vi.waitFor(() => {
        expect(view.text()).toContain(missing)
      })

      await field(view).setValue('мол')

      expect(view.text()).not.toContain(missing)
      await vi.waitFor(() => {
        expect(names(view)).toEqual([milk.name])
      })
      expect(view.get('.live').text()).not.toContain(missing)
    })

    it('is red when the server does not answer, and «Try again» asks for the same code', async () => {
      catalogueByBarcode.mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
      catalogueByBarcode.mockResolvedValueOnce(milk)
      const view = await render()

      await scan(view, CODE)
      await vi.waitFor(() => {
        expect(view.text()).toContain(en.item.barcode.error_body.replace('{code}', CODE))
      })
      await button(view, en.state.retry).trigger('click')

      await vi.waitFor(() => {
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: '' })
      })
      expect(catalogueByBarcode).toHaveBeenCalledTimes(2)
    })

    it('offline, finds an item among the recent by the code it was found by (В-2)', async () => {
      useRecentItemsStore(pinia).remember(milk, CODE)
      online(false)
      const view = await render()

      await scan(view, CODE)

      expect(catalogueByBarcode).not.toHaveBeenCalled()
      expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: '' })
    })

    it('offline, says the recent items do not know the code, and shows them', async () => {
      remembered(bread)
      online(false)
      const view = await render()

      await scan(view, CODE)

      expect(view.text()).toContain(en.item.barcode.offline_body)
      expect(names(view)).toEqual([bread.name])
      expect(useItemEntryStore(pinia).picked).toBeNull()
    })

    describe('a hint of Open Food Facts under a code nobody holds (MOL-162)', () => {
      const nutella: BarcodeHint = {
        name: 'Nutella',
        quantity: { milli: 400n, unit: 'kg' },
        url: `https://world.openfoodfacts.org/product/${CODE}`,
      }
      const hintText = 'Looks like “Nutella”, 0.4 kg'

      it('asks for it in the interface language and shows it above the button, said out loud with the miss', async () => {
        catalogueByBarcode.mockResolvedValue(null)
        catalogueBarcodeHint.mockResolvedValue(nutella)
        const view = await render()

        await scan(view, CODE)

        await vi.waitFor(() => {
          expect(view.get('.code-hint').text()).toContain(hintText)
        })
        expect(view.get('.code-hint').text()).toContain(en.item.barcode.hint_source)
        expect(catalogueBarcodeHint).toHaveBeenCalledWith(CODE, 'en')
        // Under the button, which then never moves when the hint comes (В-5, adversarial Г).
        const block = view.get('.not-found').html()
        expect(block.indexOf('code-hint')).toBeGreaterThan(block.indexOf(en.item.empty.action))
        await vi.waitFor(() => {
          expect(view.get('.live').text()).toBe(
            `${en.item.barcode.missing.replace('{code}', CODE)}. ${hintText}`,
          )
        })
      })

      it('fills «Suggest an item» opened from the block', async () => {
        catalogueByBarcode.mockResolvedValue(null)
        catalogueBarcodeHint.mockResolvedValue(nutella)
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.find('.code-hint').exists()).toBe(true)
        })

        await button(view, en.item.empty.action).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(view.get<HTMLInputElement>('dialog input[type="text"]').element.value).toBe(
          'Nutella',
        )
        expect(view.get('dialog a.source').attributes('href')).toBe(nutella.url)
      })

      it('must not say a late hint over «Suggest an item» opened meanwhile (review 3)', async () => {
        catalogueByBarcode.mockResolvedValue(null)
        let land!: (hint: BarcodeHint) => void
        catalogueBarcodeHint.mockReturnValue(new Promise((resolve) => (land = resolve)))
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await scan(view, CODE)
        const missing = en.item.barcode.missing.replace('{code}', CODE)
        await vi.waitFor(() => {
          expect(view.get('.live').text()).toBe(missing)
        })
        await button(view, en.item.empty.action).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))

        land(nutella)
        await flushPromises()
        await new Promise((resolve) => setTimeout(resolve, 150))

        expect(view.get('.live').text()).not.toContain(hintText)
        expect(view.get<HTMLInputElement>('dialog input[type="text"]').element.value).toBe('')

        // Put away with nothing proposed: the line under the button is said now (review 6).
        const propose = view.findComponent({ name: 'ProposeItemSheet' })
        propose.vm.$emit('update:open', false)
        // The sheet's own close hook, as `BottomSheet` calls it once its step back has landed.
        const closed = propose.vm.$attrs['on-closed'] as () => void
        closed()
        await vi.waitFor(() => {
          expect(view.get('.live').text()).toBe(`${missing}. ${hintText}`)
        })
      })

      it('must not show a hint the base did not give, nor fail when asking fails', async () => {
        catalogueByBarcode.mockResolvedValue(null)
        catalogueBarcodeHint.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'Failed to fetch'))
        const view = await render()

        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(en.item.barcode.missing.replace('{code}', CODE))
        })
        await flushPromises()

        expect(view.find('.code-hint').exists()).toBe(false)
        expect(button(view, en.item.empty.action).exists()).toBe(true)
      })

      it('must not ask about a shop’s own label, nor about a code someone holds', async () => {
        catalogueByBarcode.mockResolvedValue(milk)
        const view = await render()
        await scan(view, CODE)
        await scan(view, '2000000000008')
        await flushPromises()

        expect(catalogueBarcodeHint).not.toHaveBeenCalled()
      })

      it('must not show the hint of the code before: a new code asks again', async () => {
        const OTHER = '4850000000014'
        catalogueByBarcode.mockResolvedValue(null)
        catalogueBarcodeHint.mockImplementation((code) =>
          Promise.resolve(code === CODE ? nutella : null),
        )
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.find('.code-hint').exists()).toBe(true)
        })

        await scan(view, OTHER)
        await vi.waitFor(() => {
          expect(view.text()).toContain(en.item.barcode.missing.replace('{code}', OTHER))
        })
        await flushPromises()

        expect(catalogueBarcodeHint).toHaveBeenLastCalledWith(OTHER, 'en')
        expect(view.find('.code-hint').exists()).toBe(false)
      })
    })

    describe('the adversarial pass (MOL-99)', () => {
      const OTHER = '4850000000014'
      const missingOf = (code: string) => en.item.barcode.missing.replace('{code}', code)

      function deferred<T>() {
        let resolve!: (value: T) => void
        const promise = new Promise<T>((settle) => (resolve = settle))
        return { promise, resolve }
      }

      /** The first code's answer lands while the scanner is up again, then the second is read. */
      async function scanTwice(view: VueWrapper, landFirst: () => void): Promise<void> {
        await scan(view, CODE)
        await view.get(`button[aria-label="${en.item.barcode.scan}"]`).trigger('click')
        landFirst()
        await new Promise((resolve) => setTimeout(resolve, 0))
        scanner(view).vm.$emit('read', OTHER)
        scanner(view).vm.$emit('update:open', false)
        await nextTick()
        await new Promise((resolve) => setTimeout(resolve, 0))
        putAway(view)
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      it('drops a find held for the scanner once the next code is read — nobody holds it (А)', async () => {
        const first = deferred<CatalogueEntry | null>()
        catalogueByBarcode.mockImplementation((code) =>
          code === CODE ? first.promise : Promise.resolve(null),
        )
        const view = await render()

        await scanTwice(view, () => {
          first.resolve(milk)
        })

        expect(view.text()).toContain(missingOf(OTHER))
        expect(useItemEntryStore(pinia).picked).toBeNull()
      })

      it('drops it too when the next code fails (А)', async () => {
        const first = deferred<CatalogueEntry | null>()
        catalogueByBarcode.mockImplementation((code) =>
          code === CODE ? first.promise : Promise.reject(new Error('Failed to fetch')),
        )
        const view = await render()

        await scanTwice(view, () => {
          first.resolve(milk)
        })

        expect(view.text()).toContain(en.item.barcode.error_body.replace('{code}', OTHER))
        expect(useItemEntryStore(pinia).picked).toBeNull()
      })

      it('takes the next code’s item when that one is found (А, control)', async () => {
        const first = deferred<CatalogueEntry | null>()
        catalogueByBarcode.mockImplementation((code) =>
          code === CODE ? first.promise : Promise.resolve(marianna),
        )
        const view = await render()

        await scanTwice(view, () => {
          first.resolve(milk)
        })

        expect(useItemEntryStore(pinia).picked).toEqual({ entry: marianna, query: '' })
      })

      it('does not read out a search that answers under the code’s block (Б)', async () => {
        const answer = deferred<CatalogueEntry[]>()
        searchCatalogue.mockReturnValue(answer.promise)
        catalogueByBarcode.mockResolvedValue(null)
        const view = await render()
        await field(view).setValue('хлеб')
        await vi.waitFor(() => {
          expect(searchCatalogue).toHaveBeenCalledWith('хлеб')
        })
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.get('.live').text()).toBe(missingOf(CODE))
        })

        answer.resolve([bread, milk])
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(view.get('.live').text()).toBe(missingOf(CODE))
        expect(names(view)).toEqual([])
      })

      it('asks for the code again once the connection is back, quietly (Ж)', async () => {
        online(false)
        catalogueByBarcode.mockResolvedValue(milk)
        const view = await render()
        await scan(view, CODE)
        expect(view.text()).toContain(en.item.barcode.offline_body)

        online(true)
        window.dispatchEvent(new Event('online'))

        // Found — and not opened by itself: the sheet comes from a tap on the item (Ж′).
        const found = en.item.barcode.found.replace('{code}', CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(found)
        })
        expect(catalogueByBarcode).toHaveBeenCalledWith(CODE)
        expect(useItemEntryStore(pinia).picked).toBeNull()
        await vi.waitFor(() => {
          expect(view.get('.live').text()).toContain(found)
        })

        await button(view, milk.name).trigger('click')

        expect(useItemEntryStore(pinia).picked).toEqual({ entry: milk, query: '' })
      })

      it('lets a sheet opened from the recent items alone when the connection comes back (Ж′)', async () => {
        remembered(bread)
        online(false)
        catalogueByBarcode.mockResolvedValue(milk)
        const view = await render()
        await scan(view, CODE)
        expect(view.text()).toContain(en.item.barcode.offline_body)

        // The block sends the person to the recent items, and they take one.
        await view.get('[role="option"]').trigger('click')
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: bread, query: '' })

        online(true)
        window.dispatchEvent(new Event('online'))
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise((resolve) => setTimeout(resolve, 50))

        expect(catalogueByBarcode).not.toHaveBeenCalled()
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: bread, query: '' })
      })

      describe('«Suggest an item» under an unknown code (Д)', () => {
        const cheese = entry(9, 'Сыр чечил')

        async function proposeCheese(view: VueWrapper): Promise<void> {
          await button(view, en.item.empty.action).trigger('click')
          vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
          await new Promise((resolve) => setTimeout(resolve, 5))
          const name = view.get<HTMLInputElement>('dialog input[type="text"]')
          expect(name.element.value).toBe('')
          await name.setValue('Сыр чечил')
          const litre = view
            .findAll('dialog label')
            .find((label) => label.text() === en.item.unit_l)
            ?.find('input')
          await litre?.setValue(true)
          await button(view, en.item.propose.submit).trigger('click')
        }

        it('starts with no name and teaches the search no word typed before the scan', async () => {
          searchCatalogue.mockResolvedValue([bread])
          catalogueByBarcode.mockResolvedValue(null)
          proposeItem.mockResolvedValue({ entry: cheese, created: true })
          vi.spyOn(performance, 'now').mockReturnValue(0)
          const view = await render()
          await field(view).setValue('хлеб')
          await vi.waitFor(() => {
            expect(names(view)).toEqual([bread.name])
          })
          await scan(view, CODE)
          await vi.waitFor(() => {
            expect(view.text()).toContain(missingOf(CODE))
          })

          await proposeCheese(view)

          await vi.waitFor(() => {
            expect(useItemEntryStore(pinia).picked).toEqual({ entry: cheese, query: '' })
          })
          // Proposed, the code's question is answered: its block goes (review С-5).
          expect(view.text()).not.toContain(missingOf(CODE))
        })

        it('still takes the field’s word when proposed from the search’s own «not found» (control)', async () => {
          searchCatalogue.mockResolvedValue([])
          proposeItem.mockResolvedValue({ entry: cheese, created: true })
          vi.spyOn(performance, 'now').mockReturnValue(0)
          const view = await render()
          await field(view).setValue('чечил')
          await vi.waitFor(() => {
            expect(searchCatalogue).toHaveBeenCalledWith('чечил')
          })
          await vi.waitFor(() => {
            expect(view.text()).toContain(en.item.empty.action)
          })

          await button(view, en.item.empty.action).trigger('click')
          vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
          await new Promise((resolve) => setTimeout(resolve, 5))

          expect(view.get<HTMLInputElement>('dialog input[type="text"]').element.value).toBe(
            'чечил',
          )
        })
      })
    })

    it('says a shop’s own label is one, asks nothing and keeps no code waiting (MOL-100, В-4)', async () => {
      const view = await render()

      await scan(view, '20000011')

      const label = en.item.barcode.in_store.replace('{code}', '20000011')
      expect(view.text()).toContain(label)
      expect(view.text()).toContain(en.item.barcode.in_store_body)
      expect(catalogueByBarcode).not.toHaveBeenCalled()
      expect(view.findAll('button').some((b) => b.text() === en.item.empty.action)).toBe(false)
      await vi.waitFor(() => {
        expect(view.get('.live').text()).toBe(label)
      })
      await field(view).setValue('сыр')
      expect(view.text()).not.toContain(en.item.barcode.pending.replace('{code}', '20000011'))
    })

    describe('a code nobody holds waits for its item (MOL-100)', () => {
      const cream = entry(11, 'Сметана Ашхар 20%')
      const kefir = entry(12, 'Кефир 1%')
      const missing = en.item.barcode.missing.replace('{code}', CODE)
      const pending = en.item.barcode.pending.replace('{code}', CODE)
      const question = en.item.barcode.bind_question
        .replace('{code}', CODE)
        .replace('{name}', cream.name)
      const named = en.item.barcode.bind_named.replace('{code}', CODE).replace('{name}', cream.name)

      /** A miss, then «сметана» typed and its row tapped. */
      async function pickAfterMiss(view: VueWrapper): Promise<void> {
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(missing)
        })
        await field(view).setValue('сметана')
        await vi.waitFor(() => {
          expect(names(view)).toEqual([cream.name])
        })
        await view.get('[role="option"]').trigger('click')
      }

      beforeEach(() => {
        catalogueByBarcode.mockResolvedValue(null)
        searchCatalogue.mockResolvedValue([cream])
      })

      it('keeps the code over the search once something is typed, and ✕ lets it go', async () => {
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(missing)
        })

        await field(view).setValue('сметана')

        expect(view.text()).toContain(pending)
        await vi.waitFor(() => {
          expect(names(view)).toEqual([cream.name])
        })
        await view.get(`button[aria-label="${en.item.barcode.pending_drop}"]`).trigger('click')
        expect(view.text()).not.toContain(pending)
        // The ✕ goes with the strip: the field takes the focus back (adversarial О).
        await nextTick()
        expect(document.activeElement).toBe(field(view).element)
      })

      it('asks before the purchase sheet whether the code is the row’s, and says so out loud', async () => {
        const view = await render()

        await pickAfterMiss(view)

        expect(view.text()).toContain(question)
        expect(names(view)).toEqual([])
        expect(useItemEntryStore(pinia).picked).toBeNull()
        await vi.waitFor(() => {
          expect(view.get('.live').text()).toBe(question)
        })
        expect(document.activeElement?.textContent.trim()).toBe(en.item.barcode.bind)
      })

      it('writes the code to the row and then opens its sheet with the query it was found by', async () => {
        attachBarcode.mockResolvedValue({ entry: cream, created: true })
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')

        expect(attachBarcode).toHaveBeenCalledWith(cream.id, CODE)
        await vi.waitFor(() => {
          expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
        })
        expect(view.text()).not.toContain(pending)
      })

      it('records without the code when asked to, and writes nothing', async () => {
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.without_code).trigger('click')

        expect(attachBarcode).not.toHaveBeenCalled()
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
        expect(view.text()).not.toContain(pending)
      })

      it('names the item that holds the code, and takes it as found by the code', async () => {
        attachBarcode.mockResolvedValue({ taken: kefir })
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')

        const taken = en.item.barcode.taken.replace('{code}', CODE).replace('{name}', kefir.name)
        await vi.waitFor(() => {
          expect(view.text()).toContain(taken)
        })
        await button(view, en.item.propose.take.replace('{name}', kefir.name)).trigger('click')
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: kefir, query: '' })
      })

      it('offline, says the code is not linked and offers both ways on', async () => {
        attachBarcode.mockRejectedValue(new ApiError(ERROR.INTERNAL, 'transport', false))
        const view = await render()
        await pickAfterMiss(view)
        online(false)

        await button(view, en.item.barcode.bind).trigger('click')

        await vi.waitFor(() => {
          expect(view.text()).toContain(en.item.barcode.bind_offline_body)
        })
        expect(button(view, en.state.retry).exists()).toBe(true)
        await button(view, en.item.barcode.without_code).trigger('click')
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
      })

      it('must not act on the other answers while the code is on its way (review Б)', async () => {
        let land!: (written: CatalogueWrite) => void
        attachBarcode.mockReturnValue(new Promise((resolve) => (land = resolve)))
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')
        await button(view, en.item.barcode.without_code).trigger('click')
        await button(view, en.item.barcode.propose_other).trigger('click')

        expect(useItemEntryStore(pinia).picked).toBeNull()
        expect(view.find('dialog[open]').exists()).toBe(false)
        land({ entry: cream, created: true })
        await vi.waitFor(() => {
          expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
        })
      })

      it('holds the field read-only while the code is on its way, and says «taken» when it lands (Р5-Б, Р6-А)', async () => {
        let land!: (written: CatalogueWrite) => void
        attachBarcode.mockReturnValue(new Promise((resolve) => (land = resolve)))
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')

        // Nothing typed can become the miss of the row picked before it (adversarial Р6-А).
        expect(field(view).attributes('readonly')).toBeDefined()
        expect(view.text()).toContain(question)
        land({ taken: kefir })
        await vi.waitFor(() => {
          expect(view.text()).toContain(
            en.item.barcode.taken.replace('{code}', CODE).replace('{name}', kefir.name),
          )
        })
        expect(field(view).attributes('readonly')).toBeUndefined()
        expect(useItemEntryStore(pinia).picked).toBeNull()
      })

      it('leaves the focus where the person put it when «taken» lands (Р6-В)', async () => {
        let land!: (written: CatalogueWrite) => void
        attachBarcode.mockReturnValue(new Promise((resolve) => (land = resolve)))
        const view = await render()
        await pickAfterMiss(view)
        await button(view, en.item.barcode.bind).trigger('click')

        field(view).element.focus()
        land({ taken: kefir })
        await vi.waitFor(() => {
          expect(view.text()).toContain(
            en.item.barcode.taken.replace('{code}', CODE).replace('{name}', kefir.name),
          )
        })
        await nextTick()

        expect(document.activeElement).toBe(field(view).element)
      })

      it('must not read another code while one is on its way (Р5-Б)', async () => {
        attachBarcode.mockReturnValue(new Promise(() => undefined))
        const view = await render()
        await pickAfterMiss(view)
        await button(view, en.item.barcode.bind).trigger('click')
        catalogueByBarcode.mockClear()

        const scan = view.get(`button[aria-label="${en.item.barcode.scan}"]`)
        expect(scan.attributes('aria-disabled')).toBe('true')
        view.findComponent(ScannerStub).vm.$emit('read', '4850000000014')
        await nextTick()

        expect(catalogueByBarcode).not.toHaveBeenCalled()
        expect(view.text()).toContain(question)
      })

      it('writes nothing into the store when the answer lands after the screen was left (Р5-А)', async () => {
        let land!: (written: CatalogueWrite) => void
        attachBarcode.mockReturnValue(new Promise((resolve) => (land = resolve)))
        const shown = ref(true)
        const view = await render(shown)
        await pickAfterMiss(view)
        await button(view, en.item.barcode.bind).trigger('click')

        shown.value = false
        await nextTick()
        land({ entry: cream, created: true })
        await new Promise((resolve) => setTimeout(resolve, 0))

        expect(useItemEntryStore(pinia).picked).toBeNull()
      })

      it('asks the server about a code brought back from the draft, and lets it go when held (Р6-Б)', async () => {
        const first = await render()
        await scan(first, CODE)
        await vi.waitFor(() => {
          expect(first.text()).toContain(missing)
        })
        await field(first).setValue('сметана')
        // The answer to «Привязать» came while the page was gone: the code is held now.
        catalogueByBarcode.mockResolvedValue(cream)

        const view = await render()

        await vi.waitFor(() => {
          expect(view.text()).not.toContain(pending)
        })
        expect(useItemEntryStore(pinia).picked).toBeNull()
      })

      it('must not bring back a code whose write was on its way at a reload (Р6-Б)', async () => {
        attachBarcode.mockReturnValue(new Promise(() => undefined))
        const first = await render()
        await pickAfterMiss(first)
        await button(first, en.item.barcode.bind).trigger('click')

        const view = await render()

        expect(view.text()).not.toContain(pending)
      })

      it('keeps the waiting code across a reload of the window (Р5-Г)', async () => {
        const first = await render()
        await scan(first, CODE)
        await vi.waitFor(() => {
          expect(first.text()).toContain(missing)
        })
        await field(first).setValue('сметана')
        // A reload tears the page down without unmounting anything: the shelf is what is left.
        const view = await render()

        expect(view.text()).toContain(pending)
      })

      it('says an item full of codes in its own words, and records without the code (review В)', async () => {
        attachBarcode.mockRejectedValue(new ApiError(ERROR.BARCODES_FULL))
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')

        await vi.waitFor(() => {
          expect(view.text()).toContain(en.error.barcodes_full)
        })
        expect(view.findAll('button').some((b) => b.text() === en.state.retry)).toBe(false)
        await button(
          view,
          en.item.barcode.without_code_named.replace('{name}', cream.name),
        ).trigger('click')
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
      })

      it('is red on an error, and «Try again» asks again with the same code', async () => {
        attachBarcode
          .mockRejectedValueOnce(new ApiError(ERROR.INTERNAL, 'HTTP 502', false))
          .mockResolvedValue({ entry: cream, created: true })
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')
        await vi.waitFor(() => {
          expect(view.text()).toContain(en.item.barcode.bind_error_body.replace('{code}', CODE))
        })
        await button(view, en.state.retry).trigger('click')

        expect(attachBarcode).toHaveBeenLastCalledWith(cream.id, CODE)
        await vi.waitFor(() => {
          expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
        })
      })

      it('carries the code into the item proposed as «a different item», named as typed', async () => {
        proposeItem.mockResolvedValue({ entry: kefir, created: true })
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.propose_other).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(view.get<HTMLInputElement>('dialog input[type="text"]').element.value).toBe(
          'сметана',
        )
        expect(view.text()).toContain(en.item.propose.code.replace('{code}', CODE))
      })

      it('asks about the item the catalogue already holds under the name proposed (В-5)', async () => {
        searchCatalogue.mockResolvedValue([])
        proposeItem.mockResolvedValue({ entry: cream, created: false })
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(missing)
        })

        await button(view, en.item.empty.action).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))
        await view.get<HTMLInputElement>('dialog input[type="text"]').setValue(cream.name)
        const litre = view
          .findAll('dialog label')
          .find((label) => label.text() === en.item.unit_l)
          ?.find('input')
        await litre?.setValue(true)
        await button(view, en.item.propose.submit).trigger('click')
        await flushPromises()
        window.dispatchEvent(new PopStateEvent('popstate'))

        await vi.waitFor(() => {
          expect(view.text()).toContain(named)
        })
        expect(useItemEntryStore(pinia).picked).toBeNull()
        expect(attachBarcode).not.toHaveBeenCalled()
      })

      /** A miss with «хлеб» typed before the scan, then «Предложить товар» named as an item there. */
      async function proposeExistingFromMiss(view: VueWrapper): Promise<void> {
        await field(view).setValue('хлеб')
        await vi.waitFor(() => {
          expect(searchCatalogue).toHaveBeenCalledWith('хлеб')
        })
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(missing)
        })
        await button(view, en.item.empty.action).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))
        await view.get<HTMLInputElement>('dialog input[type="text"]').setValue(cream.name)
        const litre = view
          .findAll('dialog label')
          .find((label) => label.text() === en.item.unit_l)
          ?.find('input')
        await litre?.setValue(true)
        await button(view, en.item.propose.submit).trigger('click')
        await flushPromises()
        window.dispatchEvent(new PopStateEvent('popstate'))
        await vi.waitFor(() => {
          expect(view.text()).toContain(named)
        })
      }

      it('takes the item asked about from the code’s block with no query — the word before the scan is nobody’s (adversarial М)', async () => {
        proposeItem.mockResolvedValue({ entry: cream, created: false })
        attachBarcode.mockResolvedValue({ entry: cream, created: true })
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await proposeExistingFromMiss(view)

        await button(view, en.item.barcode.bind).trigger('click')

        await vi.waitFor(() => {
          expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: '' })
        })
      })

      it('opens «другой товар» empty, saying the name is taken — no circle (adversarial М, Н)', async () => {
        proposeItem.mockResolvedValue({ entry: cream, created: false })
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await proposeExistingFromMiss(view)

        await button(view, en.item.barcode.propose_other).trigger('click')
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(view.get<HTMLInputElement>('dialog input[type="text"]').element.value).toBe('')
        expect(view.text()).toContain(en.item.propose.name_taken.replace('{name}', cream.name))
      })

      it('keeps the word typed for «другой товар» of a row picked by name (control)', async () => {
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await pickAfterMiss(view)

        await button(view, en.item.barcode.propose_other).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))

        expect(view.get<HTMLInputElement>('dialog input[type="text"]').element.value).toBe(
          'сметана',
        )
        expect(view.text()).not.toContain(en.item.propose.name_taken.replace('{name}', cream.name))
      })

      it('drops the question when typing goes on, and the code still waits', async () => {
        const view = await render()
        await pickAfterMiss(view)

        await field(view).setValue('сметана ашх')

        expect(view.text()).not.toContain(question)
        expect(view.text()).toContain(pending)
      })

      it('must not ask when no code waits — a row is picked as it always was', async () => {
        const view = await render()
        await field(view).setValue('сметана')
        await vi.waitFor(() => {
          expect(names(view)).toEqual([cream.name])
        })

        await view.get('[role="option"]').trigger('click')

        expect(view.text()).not.toContain(question)
        expect(useItemEntryStore(pinia).picked).toEqual({ entry: cream, query: 'сметана' })
      })

      it('must not keep a code the server was not asked about — offline is no miss', async () => {
        online(false)
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(en.item.barcode.offline_body)
        })
        online(true)

        await field(view).setValue('сметана')

        expect(view.text()).not.toContain(pending)
      })

      it('sends the waiting code with an item proposed from the search', async () => {
        searchCatalogue.mockResolvedValue([])
        proposeItem.mockResolvedValue({ entry: cream, created: true })
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(view.text()).toContain(missing)
        })
        await field(view).setValue('сметана ашхар')
        await vi.waitFor(() => {
          expect(view.text()).toContain(en.item.empty.action)
        })

        await button(view, en.item.empty.action).trigger('click')
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))
        const litre = view
          .findAll('dialog label')
          .find((label) => label.text() === en.item.unit_l)
          ?.find('input')
        await litre?.setValue(true)
        await button(view, en.item.propose.submit).trigger('click')

        expect(proposeItem).toHaveBeenCalledWith(
          expect.objectContaining({ name: 'сметана ашхар', barcodes: [CODE] }),
        )
      })

      it('lets a wrong code go from the sheet of the item found by it, and asks the code again', async () => {
        catalogueByBarcode.mockResolvedValueOnce(kefir).mockResolvedValue(null)
        detachBarcode.mockResolvedValue()
        vi.spyOn(performance, 'now').mockReturnValue(0)
        const view = await render()
        await scan(view, CODE)
        await vi.waitFor(() => {
          expect(useItemEntryStore(pinia).picked).toEqual({ entry: kefir, query: '' })
        })
        vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
        await new Promise((resolve) => setTimeout(resolve, 5))

        await button(view, en.item.barcode.not_this.replace('{code}', CODE)).trigger('click')
        await nextTick()
        await button(view, en.item.barcode.detach).trigger('click')

        expect(detachBarcode).toHaveBeenCalledWith(kefir.id, CODE)
        window.dispatchEvent(new PopStateEvent('popstate'))
        await vi.waitFor(() => {
          expect(catalogueByBarcode).toHaveBeenCalledTimes(2)
        })
        await vi.waitFor(() => {
          expect(view.text()).toContain(missing)
        })
      })
    })

    it('opens the scanner at once when the screen was asked to scan — once', async () => {
      useItemEntryStore(pinia).askToScan()

      const first = await render()
      await nextTick()
      expect(first.find('.scanner').exists()).toBe(true)

      const second = await render()
      await nextTick()
      expect(second.find('.scanner').exists()).toBe(false)
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

    it('remembers the code an item was found by once it went into the trip — offline it finds it (MOL-99)', async () => {
      catalogueByBarcode.mockResolvedValue(milk)
      const view = await render()
      await view.get(`button[aria-label="${en.item.barcode.scan}"]`).trigger('click')
      const scanner = view.findComponent(ScannerStub)
      scanner.vm.$emit('read', '10000076')
      scanner.vm.$emit('update:open', false)
      await nextTick()
      ;(scanner.props('onClosed') as () => void)()
      await vi.waitFor(() => {
        expect(useItemEntryStore(pinia).picked?.entry).toEqual(milk)
      })
      await nextTick()
      expect(useRecentItemsStore(pinia).byCode('10000076')).toBeNull()
      vi.spyOn(performance, 'now').mockReturnValue(1_000_000)
      await new Promise((resolve) => setTimeout(resolve, 5))

      const add = view.findAll('dialog[open] button').find((b) => b.text() === en.item.save)
      await add?.trigger('click')

      const [write] = useTripQueueStore(pinia).pending
      expect(write).toMatchObject({ kind: 'add', entry: milk })
      if (write?.kind === 'add') expect(write.body.query).toBeUndefined()
      // Typed from the label it is thirteen digits, and finds it all the same (С-14).
      expect(useRecentItemsStore(pinia).byCode('0100000000076')).toEqual(milk)
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
