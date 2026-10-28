import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpendingCategoryView } from '@molvia/model'
import CategoryPickerSheet from './CategoryPickerSheet.vue'
import { createAppI18n } from '@/i18n'
import en from '@/i18n/en.json'
import { routes } from '@/router'

let clock = 0
const views: VueWrapper[] = []

beforeEach(() => {
  vi.restoreAllMocks()
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  setActivePinia(createPinia())
})

afterEach(() => {
  for (const view of views.splice(0)) view.unmount()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  document.body.innerHTML = ''
})

const CAFE = 'c0000000-0000-4000-8000-000000000001'
const RENT = 'c0000000-0000-4000-8000-000000000002'
const TAXI = 'c0000000-0000-4000-8000-000000000003'
const categories: SpendingCategoryView[] = [
  { id: CAFE, preset: 'cafe', name: null, colour: null, icon: null, archived: false },
  { id: RENT, preset: 'rent', name: null, colour: null, icon: null, archived: false },
  { id: TAXI, preset: null, name: 'Taxi', colour: 3, icon: 'taxi', archived: false },
]

async function render(selected: string | null): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/money')
  const view = mount(CategoryPickerSheet, {
    props: {
      open: true,
      categories,
      nameOf: (category: SpendingCategoryView) =>
        category.preset ? en.spending.category[category.preset] : (category.name ?? ''),
      selected,
    },
    attachTo: document.body,
    global: { plugins: [router, createAppI18n('en')] },
  })
  views.push(view)
  // Past the moment the sheet rises: until then it takes no tap at all.
  await flushPromises()
  clock += 1000
  await new Promise((resolve) => setTimeout(resolve, 5))
  return view
}

const radios = () => [...document.querySelectorAll('dialog[open] [role="radio"]')]

describe('CategoryPickerSheet — «Ещё…» (MOL-198)', () => {
  it('lists every category in the order given, the chosen one checked, «Own» under the group', async () => {
    await render(RENT)
    const dialog = document.querySelector('dialog[open]')
    const title = document.getElementById(dialog?.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent.trim()).toBe(en.spending.sheet.more_title)
    expect(radios().map((row) => row.textContent.trim())).toEqual([
      en.spending.category.cafe,
      en.spending.category.rent,
      'Taxi',
    ])
    expect(radios().map((row) => row.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
    const rows = [...document.querySelectorAll('dialog[open] li')]
    expect(rows.at(-1)?.textContent.trim()).toBe(en.spending.sheet.add_category)
    // «Own» is no choice: out of the group of radios (self-review №5).
    const group = document.querySelector('dialog[open] [role="radiogroup"]')
    expect(group?.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(group?.textContent).not.toContain(en.spending.sheet.add_category)
    // A dot of its colour on every row, never an icon: the list is the chips' (owner's В-3 «а»).
    expect(document.querySelectorAll('dialog[open] [role="radio"] .dot')).toHaveLength(3)
  })

  it('chooses with a tap and goes back: there is nothing to confirm', async () => {
    const view = await render(null)
    ;(radios()[2] as HTMLElement).click()
    expect(view.emitted('pick')).toEqual([[TAXI]])
    expect(view.emitted('update:open')).toEqual([[false]])
  })

  it('«Own» asks for a new one and leaves the list up under it', async () => {
    const view = await render(CAFE)
    const add = [...document.querySelectorAll<HTMLElement>('dialog[open] li button')].at(-1)
    expect(add?.getAttribute('aria-haspopup')).toBe('dialog')
    add?.click()
    expect(view.emitted('add')).toHaveLength(1)
    expect(view.emitted('update:open')).toBeUndefined()
  })
})
