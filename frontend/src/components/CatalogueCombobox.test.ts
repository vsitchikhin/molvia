import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { CATALOGUE_QUERY_MAX } from '@molvia/model'
import type { CatalogueEntry } from '@molvia/model'
import CatalogueCombobox from '@/components/CatalogueCombobox.vue'

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
const marianna = entry(2, 'Молоко «Марианна»', 'пастеризованное, 3,2%')
const condensed = entry(3, 'Молоко сгущённое')

const mounted: VueWrapper[] = []

function combobox(props: { items?: CatalogueEntry[]; stale?: boolean; modelValue?: string } = {}) {
  const wrapper = mount(CatalogueCombobox, {
    attachTo: document.body,
    props: {
      modelValue: props.modelValue ?? 'молок',
      items: props.items ?? [milk, marianna, condensed],
      heading: 'Нашли',
      label: 'Что взяли?',
      placeholder: 'Молоко, matsun, сыр…',
      hint: 'Можно с опечатками и латиницей',
      stale: props.stale ?? false,
    },
    slots: { before: '<p class="before">до</p>', after: '<p class="after">после</p>' },
  })
  mounted.push(wrapper)
  return wrapper
}

function field(wrapper: VueWrapper) {
  return wrapper.get('input')
}

async function press(wrapper: VueWrapper, key: string, init: KeyboardEventInit = {}) {
  await field(wrapper).trigger('keydown', { key, ...init })
}

function activeName(wrapper: VueWrapper): string | undefined {
  const id = field(wrapper).attributes('aria-activedescendant')
  if (id === undefined) return undefined
  return wrapper
    .get(`#${CSS.escape(id)}`)
    .get('.name')
    .text()
}

// happy-dom draws nothing, so there is nothing to scroll; the call itself is what is checked.
const scrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>()

beforeEach(() => {
  scrolled.mockReset()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrolled,
  })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  if (scrollIntoView) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollIntoView)
  vi.restoreAllMocks()
})

describe('the catalogue combobox', () => {
  it('is a combobox controlling a listbox named by its heading', () => {
    const wrapper = combobox()
    const input = field(wrapper)
    const list = wrapper.get('[role="listbox"]')

    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-controls')).toBe(list.attributes('id'))
    expect(input.attributes('aria-label')).toBe('Что взяли?')
    expect(wrapper.get(`#${CSS.escape(list.attributes('aria-labelledby') ?? '')}`).text()).toBe(
      'Нашли',
    )
    expect(wrapper.findAll('[role="option"]')).toHaveLength(3)
  })

  it('is collapsed, with nothing to control, when there are no rows', () => {
    const wrapper = combobox({ items: [] })

    expect(field(wrapper).attributes('aria-expanded')).toBe('false')
    expect(field(wrapper).attributes('aria-controls')).toBeUndefined()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.find('.heading').exists()).toBe(false)
  })

  it('carries the attributes of a search field on a phone', () => {
    const input = field(combobox())

    expect(input.attributes()).toMatchObject({
      type: 'search',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      placeholder: 'Молоко, matsun, сыр…',
    })
  })

  it('stops at the length the server accepts, so a pasted page is not a «server error»', () => {
    expect(field(combobox()).attributes('maxlength')).toBe(String(CATALOGUE_QUERY_MAX))
  })

  it('describes the field by its hint', () => {
    const wrapper = combobox()
    const hint = wrapper.get(`#${CSS.escape(field(wrapper).attributes('aria-describedby') ?? '')}`)

    expect(hint.text()).toBe('Можно с опечатками и латиницей')
  })

  it('takes the focus when it appears — the person came to type', () => {
    const wrapper = combobox()

    expect(document.activeElement).toBe(field(wrapper).element)
  })

  it('hands every keystroke up as typed', async () => {
    const wrapper = combobox({ modelValue: '' })

    await field(wrapper).setValue(' Мол ')

    expect(wrapper.emitted('update:modelValue')).toEqual([[' Мол ']])
  })

  it('shows the note under the name, and nothing where there is none', () => {
    const rows = combobox().findAll('[role="option"]')

    expect(rows[0]?.get('.meta').text()).toBe('ультрапастеризованное, 2,5%')
    expect(rows[2]?.find('.meta').exists()).toBe(false)
  })

  it('keeps the rows in the order they came', () => {
    const names = combobox({ items: [condensed, milk, marianna] })
      .findAll('.name')
      .map((name) => name.text())

    expect(names).toEqual([condensed.name, milk.name, marianna.name])
  })

  describe('from the keyboard', () => {
    it('has no active row until an arrow makes one', () => {
      const wrapper = combobox()

      expect(field(wrapper).attributes('aria-activedescendant')).toBeUndefined()
      expect(wrapper.find('.active').exists()).toBe(false)
    })

    it('moves down and up, wrapping at both ends', async () => {
      const wrapper = combobox()

      await press(wrapper, 'ArrowDown')
      expect(activeName(wrapper)).toBe(milk.name)
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'ArrowDown')
      expect(activeName(wrapper)).toBe(condensed.name)
      await press(wrapper, 'ArrowDown')
      expect(activeName(wrapper)).toBe(milk.name)
      await press(wrapper, 'ArrowUp')
      expect(activeName(wrapper)).toBe(condensed.name)
    })

    it('starts from the last row when the first arrow is up', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowUp')

      expect(activeName(wrapper)).toBe(condensed.name)
    })

    it('marks the active row selected for a screen reader and for the eye', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'ArrowDown')
      const rows = wrapper.findAll('[role="option"]')

      expect(rows.map((row) => row.attributes('aria-selected'))).toEqual(['false', 'true', 'false'])
      expect(rows[1]?.classes()).toContain('active')
    })

    it('brings the active row into view by the nearest edge, not the centre', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'ArrowDown')
      await wrapper.vm.$nextTick()

      expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' })
    })

    it('takes the active row on Enter', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'Enter')

      expect(wrapper.emitted('pick')).toEqual([[marianna]])
    })

    it('takes nothing on Enter with no active row, and hides the keyboard instead', async () => {
      const wrapper = combobox()
      await press(wrapper, 'Enter')

      expect(wrapper.emitted('pick')).toBeUndefined()
      expect(document.activeElement).not.toBe(field(wrapper).element)
    })

    it('leaves Enter to an input method finishing a word', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'Enter', { isComposing: true })

      expect(wrapper.emitted('pick')).toBeUndefined()
      expect(document.activeElement).toBe(field(wrapper).element)
    })

    it('lets go of the active row on Escape', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'Escape')

      expect(field(wrapper).attributes('aria-activedescendant')).toBeUndefined()
    })

    it('does nothing with arrows over an empty list', async () => {
      const wrapper = combobox({ items: [] })
      await press(wrapper, 'ArrowDown')
      await press(wrapper, 'Enter')

      expect(field(wrapper).attributes('aria-activedescendant')).toBeUndefined()
      expect(wrapper.emitted('pick')).toBeUndefined()
    })

    it('forgets the active row when a new answer arrives — it belonged to the old question', async () => {
      const wrapper = combobox()
      await press(wrapper, 'ArrowDown')
      await wrapper.setProps({ items: [marianna, condensed] })

      expect(field(wrapper).attributes('aria-activedescendant')).toBeUndefined()
      await press(wrapper, 'Enter')
      expect(wrapper.emitted('pick')).toBeUndefined()
    })
  })

  it('takes a row on a tap', async () => {
    const wrapper = combobox()
    await wrapper.findAll('[role="option"]')[2]?.trigger('click')

    expect(wrapper.emitted('pick')).toEqual([[condensed]])
  })

  it('dims a previous answer while the next one is out, and says it is busy', () => {
    const list = combobox({ stale: true }).get('[role="listbox"]')

    expect(list.classes()).toContain('stale')
    expect(list.attributes('aria-busy')).toBe('true')
  })

  it('puts what the screen gives it before and after the list', () => {
    const html = combobox().html()

    expect(html.indexOf('class="before"')).toBeLessThan(html.indexOf('role="listbox"'))
    expect(html.indexOf('class="after"')).toBeGreaterThan(html.indexOf('role="listbox"'))
  })
})
