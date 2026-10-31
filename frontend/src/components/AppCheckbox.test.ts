import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppCheckbox from './AppCheckbox.vue'

function render(
  props: { checked: boolean; inactive?: boolean },
  attrs: Record<string, string> = {},
) {
  return mount(AppCheckbox, {
    props,
    attrs,
    slots: { default: 'I am 16 or older' },
    attachTo: document.body,
  })
}

describe('AppCheckbox (MOL-235)', () => {
  it('is a native checkbox named by its words, showing what it is given', () => {
    const view = render({ checked: true })
    const input = view.get<HTMLInputElement>('input')
    expect(input.attributes('type')).toBe('checkbox')
    expect(input.element.checked).toBe(true)
    // The words and the box are one label: a tap on either is the checkbox's.
    expect(view.element.tagName).toBe('LABEL')
    expect(view.text()).toBe('I am 16 or older')
    view.unmount()
  })

  it('says which way it was moved', async () => {
    const view = render({ checked: false })
    await view.get('input').setValue(true)
    await view.get('input').setValue(false)
    expect(view.emitted('update:checked')).toEqual([[true], [false]])
    view.unmount()
  })

  it('a tap on its words moves it as a tap on the box does', () => {
    const view = render({ checked: false })
    view.get<HTMLElement>('.words').element.click()
    expect(view.emitted('update:checked')).toEqual([[true]])
    view.unmount()
  })

  // Laid out by the screen as a field is (self-review №4): a class on the box moved it inside the row.
  it('puts a class and a style of its owner on the row, not on the box', () => {
    const view = render({ checked: false }, { class: 'age', style: 'margin-top: 8px' })
    expect(view.classes()).toContain('age')
    expect(view.attributes('style')).toContain('margin-top: 8px')
    expect(view.get('input').classes()).not.toContain('age')
    expect(view.get('input').attributes('style')).toBeUndefined()
    view.unmount()
  })

  it('takes an id and a description from its owner, on the checkbox', () => {
    const view = render({ checked: false }, { id: 'aged', 'aria-describedby': 'hint' })
    expect(view.get('input').attributes('id')).toBe('aged')
    expect(view.get('input').attributes('aria-describedby')).toBe('hint')
    expect(view.attributes('id')).toBeUndefined()
    view.unmount()
  })

  // «On» by more than colour (Ф-5): the ✓, hidden from a screen reader, which reads the checkbox.
  it('carries a ✓ for «on», unheard', () => {
    const view = render({ checked: true })
    expect(view.get('.check').attributes('aria-hidden')).toBe('true')
    view.unmount()
  })
})

describe('inactive (Ф-6)', () => {
  it('stays in the focus order, said to be unavailable', () => {
    const view = render({ checked: false, inactive: true })
    const input = view.get('input')
    expect(input.attributes('disabled')).toBeUndefined()
    expect(input.attributes('aria-disabled')).toBe('true')
    expect(view.classes()).toContain('app-checkbox-inactive')
    view.unmount()
  })

  // Space on a checkbox is a click too.
  it('must not fire: a click on the box or on its words moves nothing and reports nothing', () => {
    const view = render({ checked: false, inactive: true })
    const input = view.get<HTMLInputElement>('input')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    input.element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    view.get<HTMLElement>('.words').element.click()
    expect(input.element.checked).toBe(false)
    expect(view.emitted('update:checked')).toBeUndefined()
    view.unmount()
  })

  it('answers again once it is not inactive', async () => {
    const view = render({ checked: false, inactive: true })
    await view.setProps({ inactive: false })
    expect(view.get('input').attributes('aria-disabled')).toBeUndefined()
    await view.get('input').setValue(true)
    expect(view.emitted('update:checked')).toEqual([[true]])
    view.unmount()
  })
})
