import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppSwitch from './AppSwitch.vue'

it('is a native checkbox read out as a switch, showing what it is given', () => {
  const view = mount(AppSwitch, { props: { checked: true } })
  const input = view.get<HTMLInputElement>('input')
  expect(input.attributes('type')).toBe('checkbox')
  expect(input.attributes('role')).toBe('switch')
  expect(input.element.checked).toBe(true)
})

it('says which way it was moved, and nothing else', async () => {
  const view = mount(AppSwitch, { props: { checked: false } })
  await view.get('input').setValue(true)
  await view.get('input').setValue(false)
  expect(view.emitted('toggle')).toEqual([[true], [false]])
})

it('takes a description and an id from its owner, on the checkbox', () => {
  const view = mount(AppSwitch, {
    props: { checked: false },
    attrs: { id: 'reminders', 'aria-describedby': 'hint' },
  })
  const input = view.get('input')
  expect(input.attributes('aria-describedby')).toBe('hint')
  expect(input.attributes('id')).toBe('reminders')
  expect(view.attributes('aria-describedby')).toBeUndefined()
})

// «Включено» not by colour alone (Ф-5, MOL-174): the ✓ rides the knob, hidden from a screen
// reader, which reads the switch's own state.
it('carries a ✓ for «on», hidden from a screen reader', () => {
  const view = mount(AppSwitch, { props: { checked: true } })
  expect(view.find('.knob .check').exists()).toBe(true)
  expect(view.get('.knob').attributes('aria-hidden')).toBe('true')
})

describe('inactive (Ф-6, MOL-174)', () => {
  it('stays in the focus order, said to be unavailable', () => {
    const view = mount(AppSwitch, { props: { checked: true, inactive: true } })
    const input = view.get('input')
    expect(input.attributes('disabled')).toBeUndefined()
    expect(input.attributes('aria-disabled')).toBe('true')
    expect(view.classes()).toContain('inactive')
  })

  // Space on a checkbox is a click too, and so is a tap on its label.
  it('must not fire: a click moves nothing and reports nothing', () => {
    const host = document.body.appendChild(document.createElement('div'))
    const view = mount(AppSwitch, { props: { checked: false, inactive: true }, attachTo: host })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    view.get('input').element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(view.emitted('toggle')).toBeUndefined()
    expect(view.classes()).not.toContain('live')
    view.unmount()
    host.remove()
  })

  it('answers again once it is not inactive', async () => {
    const view = mount(AppSwitch, { props: { checked: false, inactive: true } })
    await view.setProps({ inactive: false })
    expect(view.get('input').attributes('aria-disabled')).toBeUndefined()
    await view.get('input').setValue(true)
    expect(view.emitted('toggle')).toEqual([[true]])
  })

  it('draws a native disabled the same, out of the focus order', () => {
    const view = mount(AppSwitch, { props: { checked: false, disabled: true } })
    expect(view.get('input').attributes('disabled')).toBeDefined()
    expect(view.classes()).toContain('inactive')
  })
})

it('moves by itself only after a finger moved it: an answer read is not played (review №1)', async () => {
  const view = mount(AppSwitch, { props: { checked: false } })
  await view.setProps({ checked: true })
  expect(view.classes()).not.toContain('live')
  await view.get('input').setValue(false)
  expect(view.classes()).toContain('live')
})
