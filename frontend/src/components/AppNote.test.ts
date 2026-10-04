import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IconAlert from '~icons/mdi/alert-outline'
import AppNote from '@/components/AppNote.vue'

describe('AppNote', () => {
  it('is a plain note with the information icon unless told otherwise', () => {
    const view = mount(AppNote, { slots: { default: 'Валюты совпадают' } })
    expect(view.classes()).toContain('plain')
    expect(view.get('.icon').attributes('aria-hidden')).toBe('true')
    expect(view.text()).toBe('Валюты совпадают')
  })

  it('takes the warn tone and an icon of its own', () => {
    const view = mount(AppNote, {
      props: { tone: 'warn', icon: IconAlert },
      slots: { default: 'Города нет в списке' },
    })
    expect(view.classes()).toContain('warn')
    expect(view.find('.icon').exists()).toBe(true)
  })

  // What comes and goes is said by the one polite region of App.vue (MOL-19), never by a note.
  it('is no live region', () => {
    const view = mount(AppNote, { slots: { default: 'Справка' } })
    expect(view.attributes('role')).toBeUndefined()
    expect(view.attributes('aria-live')).toBeUndefined()
  })
})
