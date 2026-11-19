import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { SpendingCategoryView } from '@molvia/model'
import CategoryPickerSheet from '@/components/CategoryPickerSheet.vue'
import NavRow from '@/components/NavRow.vue'
import { categoryIcon, tripIcon, tripLook } from '@/components/spending'
import TripCategoryRow from '@/components/TripCategoryRow.vue'
import { createAppI18n } from '@/i18n'

const preset = (n: number, key: SpendingCategoryView['preset']): SpendingCategoryView => ({
  id: `c0000000-0000-4000-8000-00000000000${String(n)}`,
  preset: key,
  name: null,
  colour: null,
  icon: null,
  archived: false,
})
const groceries = preset(1, 'groceries')
const cafe = preset(2, 'cafe')
const NAMES: Record<string, string> = { cafe: 'Кафе', groceries: 'Продукты' }
const nameOf = (category: SpendingCategoryView) => NAMES[category.preset ?? ''] ?? ''

function field(
  selected: string | null | undefined,
  categories: SpendingCategoryView[] = [groceries, cafe],
) {
  const view = mount(TripCategoryRow, {
    props: { categories, nameOf, selected },
    global: {
      plugins: [
        createPinia(),
        createAppI18n('ru'),
        // the picker is a sheet, and a sheet keeps its entry in the history (MOL-80)
        createRouter({
          history: createMemoryHistory(),
          routes: [{ path: '/', component: { render: () => null } }],
        }),
      ],
    },
    attachTo: document.body,
  })
  const row = view.findComponent(NavRow)
  return {
    view,
    value: row.props('value') as string,
    icon: row.props('icon') as unknown,
    chosen: view.findComponent(CategoryPickerSheet).props('selected') as string | null,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('«Категория ›» of a trip (MOL-400, MOL-406)', () => {
  it('names the trip’s category, chosen in the list', () => {
    const { view, value, icon, chosen } = field(cafe.id)
    expect([value, icon, chosen]).toEqual(['Кафе', categoryIcon(cafe), cafe.id])
    view.unmount()
  })

  it('a trip naming none is «Продукты», chosen in the list', () => {
    const { view, value, chosen } = field(null)
    expect([value, chosen]).toEqual(['Продукты', groceries.id])
    view.unmount()
  })

  it('a category the list lacks is not known: the cart, the row’s word, nothing chosen — never «Продукты» (adversarial Р3-В1)', () => {
    const { view, value, icon, chosen } = field('c0000000-0000-4000-8000-0000000000aa')
    expect([value, icon, chosen]).toEqual(['Прочее', tripIcon, null])
    view.unmount()
  })

  it('and so is one not said at all — `undefined` is no «Продукты» on its way in (adversarial Р4-Г1)', () => {
    const { view, value, icon, chosen } = field(undefined)
    expect([value, icon, chosen]).toEqual(['Прочее', tripIcon, null])
    view.unmount()
  })

  it('«Продукты» with no list keeps its preset’s icon, as the row draws it (review №18)', () => {
    const { view, value, icon } = field(null, [])
    expect([value, icon]).toEqual(['Продукты', tripLook(null).icon])
    view.unmount()
  })
})
