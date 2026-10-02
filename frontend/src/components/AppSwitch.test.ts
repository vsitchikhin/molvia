import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
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

it('takes disabled and a description from its owner', () => {
  const view = mount(AppSwitch, {
    props: { checked: false },
    attrs: { disabled: true, 'aria-describedby': 'hint' },
  })
  const input = view.get('input')
  expect(input.attributes('disabled')).toBeDefined()
  expect(input.attributes('aria-describedby')).toBe('hint')
})
