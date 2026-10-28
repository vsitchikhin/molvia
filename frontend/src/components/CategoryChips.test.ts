import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { SpendingCategoryView } from '@molvia/model'
import CategoryChips from '@/components/CategoryChips.vue'

const NAMES = ['Продукты', 'Кафе и рестораны', 'Транспорт', 'Животные', 'Связь и интернет']
const categories: SpendingCategoryView[] = NAMES.map((name, index) => ({
  id: `c0000000-0000-4000-8000-00000000000${String(index)}`,
  preset: null,
  name,
  colour: index,
  icon: 'tag',
  archived: false,
}))
// Each chip as wide as the browser drew it in the handoff's frame; «Ещё…» 66; the rows 8 apart. No
// layout here — the widths and the gap are what a browser would measure.
const WIDTHS: Record<string, number> = {
  Продукты: 115,
  'Кафе и рестораны': 170,
  Транспорт: 120,
  Животные: 115,
  'Связь и интернет': 168,
  'Ещё…': 66,
}

/** The browser's measure: the field `row` wide, every chip at its own width, 8 between them. */
function laidOut(row: number): void {
  const style = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = style(element, pseudo)
    if (!(element instanceof HTMLElement && element.classList.contains('ruler'))) return computed
    return new Proxy(computed, {
      get: (target, key) => (key === 'columnGap' ? '8px' : Reflect.get(target, key)),
    })
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const width = this.classList.contains('chips-field')
      ? row
      : (WIDTHS[this.textContent.trim()] ?? 0)
    return { width, height: 44, top: 0, left: 0, right: width, bottom: 44, x: 0, y: 0 } as DOMRect
  })
}

function chips(modelValue: string | null = null, error: string | null = null) {
  return mount(CategoryChips, {
    props: {
      modelValue,
      categories,
      nameOf: (category: SpendingCategoryView) => category.name ?? '',
      legend: 'Категория',
      moreLabel: 'Ещё…',
      error,
    },
    attachTo: document.body,
  })
}

const rowsOf = (wrapper: ReturnType<typeof chips>) =>
  wrapper.findAll('.chips .row').map((row) => row.findAll('.chip').map((chip) => chip.text()))

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('CategoryChips — two rows and «Ещё…» (MOL-198, Ф-17)', () => {
  it('stands two rows as measured at 390, «Ещё…» last in the second', async () => {
    laidOut(358)
    const wrapper = chips()
    await nextTick()
    expect(rowsOf(wrapper)).toEqual([
      ['Продукты', 'Кафе и рестораны'],
      ['Транспорт', 'Животные', 'Ещё…'],
    ])
    // The radios are the chips shown, and no more: arrows walk them, the rest are in the list.
    expect(wrapper.findAll('input[type="radio"]')).toHaveLength(4)
  })

  it('stands fewer at 320, the same order', async () => {
    laidOut(288)
    const wrapper = chips()
    await nextTick()
    expect(rowsOf(wrapper)).toEqual([['Продукты'], ['Кафе и рестораны', 'Ещё…']])
  })

  it('stands every chip until there is a measure — a sheet still shut', async () => {
    laidOut(0)
    const wrapper = chips()
    await nextTick()
    expect(rowsOf(wrapper)).toEqual([[...NAMES, 'Ещё…']])
  })

  it('opens the list from «Ещё…», which says it opens a sheet', async () => {
    laidOut(358)
    const wrapper = chips()
    await nextTick()
    const more = wrapper.get('button.more')
    expect(more.attributes('aria-haspopup')).toBe('dialog')
    await more.trigger('click')
    expect(wrapper.emitted('more')).toHaveLength(1)
  })

  it('chooses by a tap and moves no chip: the order is the sheet’s', async () => {
    laidOut(358)
    const wrapper = chips(categories[0]?.id ?? null)
    await nextTick()
    await wrapper.findAll('input[type="radio"]')[2]?.setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[categories[2]?.id]])
    expect(rowsOf(wrapper)).toEqual([
      ['Продукты', 'Кафе и рестораны'],
      ['Транспорт', 'Животные', 'Ещё…'],
    ])
  })

  it('marks the chosen one by its form, every chip of one weight', async () => {
    laidOut(358)
    const wrapper = chips(categories[1]?.id ?? null)
    await nextTick()
    const on = wrapper.findAll('label.chip.on')
    expect(on.map((chip) => chip.text())).toEqual(['Кафе и рестораны'])
    expect(wrapper.find('input:checked').attributes('value')).toBe(categories[1]?.id)
  })

  it('says the error under the rows, on the radios and not on «Ещё…»', async () => {
    laidOut(358)
    const wrapper = chips(null, 'Выберите категорию')
    await nextTick()
    const field = wrapper.get('fieldset')
    const error = wrapper.get('.error')
    expect(error.text()).toBe('Выберите категорию')
    expect(field.attributes('aria-describedby')).toBe(error.attributes('id'))
    expect(
      wrapper.findAll('input[type="radio"]').every((radio) => radio.attributes('aria-invalid')),
    ).toBe(true)
    expect(wrapper.get('button.more').attributes('aria-invalid')).toBeUndefined()
  })
})

// Adversarial А1 of MOL-198: a chip chosen by a tap went out of the two rows at the next measure — the
// phone turned, a name grown longer by an answer — and nothing on the sheet said what was chosen, while
// «Сохранить трату» still saved it. The chosen one is lifted first there, as the sheet does at its opening.
describe('CategoryChips — the chosen one never leaves the rows (adversarial А1)', () => {
  let field = 358
  let resized: (() => void) | null = null
  const LONGER: Record<string, number> = { ...WIDTHS, 'Транспорт и такси': 175 }
  const PETS = categories[3]?.id ?? ''
  const TELECOM = categories[4]?.id ?? ''

  function laidAt(): void {
    field = 358
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe(): void {
          // The test calls `resized` itself, as the browser would on a new width.
        }
        disconnect(): void {
          resized = null
        }
      },
    )
    const style = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const computed = style(element, pseudo)
      if (!(element instanceof HTMLElement && element.classList.contains('ruler'))) return computed
      return new Proxy(computed, {
        get: (target, key) => (key === 'columnGap' ? '8px' : Reflect.get(target, key)),
      })
    })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const width = this.classList.contains('chips-field')
        ? field
        : (LONGER[this.textContent.trim()] ?? 0)
      return { width, height: 44, top: 0, left: 0, right: width, bottom: 44, x: 0, y: 0 } as DOMRect
    })
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    resized = null
  })
  const checked = () => document.querySelector<HTMLInputElement>('.chips input:checked')?.value

  async function tappedPets() {
    laidAt()
    const wrapper = chips()
    await nextTick()
    await wrapper.find(`input[value="${PETS}"]`).setValue(true)
    await wrapper.setProps({ modelValue: PETS })
    // A tap moves nothing: «Животные» stays where it stood.
    expect(rowsOf(wrapper)).toEqual([
      ['Продукты', 'Кафе и рестораны'],
      ['Транспорт', 'Животные', 'Ещё…'],
    ])
    return wrapper
  }

  it('the field narrowed to 288: the chosen one stands first, checked', async () => {
    const wrapper = await tappedPets()
    // A tap lifts nothing.
    expect(wrapper.emitted('lift')).toBeUndefined()
    field = 288
    resized?.()
    await nextTick()
    // The sheet is told, so its order — the list «More…» — takes it first too (review 2, Р2-А1).
    expect(wrapper.emitted('lift')).toEqual([[PETS]])
    expect(rowsOf(wrapper)).toEqual([
      ['Животные', 'Продукты'],
      ['Кафе и рестораны', 'Ещё…'],
    ])
    expect(checked()).toBe(PETS)
  })

  it('a name before it grown longer by an answer: the chosen one stands first, checked', async () => {
    const wrapper = await tappedPets()
    await wrapper.setProps({
      categories: categories.map((one) =>
        one.name === 'Транспорт' ? { ...one, name: 'Транспорт и такси' } : one,
      ),
    })
    // The ruler is drawn anew, then measured.
    await flushPromises()
    expect(rowsOf(wrapper)[0]?.[0]).toBe('Животные')
    expect(checked()).toBe(PETS)
  })

  it('chosen from outside the rows, it is laid in first; chosen within them, nothing moves', async () => {
    laidAt()
    const wrapper = chips()
    await nextTick()
    await wrapper.setProps({ modelValue: categories[1]?.id ?? '' })
    await nextTick()
    expect(rowsOf(wrapper)).toEqual([
      ['Продукты', 'Кафе и рестораны'],
      ['Транспорт', 'Животные', 'Ещё…'],
    ])
    await wrapper.setProps({ modelValue: TELECOM })
    await nextTick()
    expect(rowsOf(wrapper)[0]?.[0]).toBe('Связь и интернет')
    expect(checked()).toBe(TELECOM)
  })
})
