import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AppCard from '@/components/AppCard.vue'
import source from '@/components/AppCard.vue?raw'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppCard', () => {
  it('is a plain surface by default', () => {
    const view = mount(AppCard, { slots: { default: 'Milk' } })
    expect(view.element.tagName).toBe('DIV')
    expect(view.classes()).toEqual(['card', 'plain'])
    expect(view.text()).toBe('Milk')
  })

  // The screen knows what the content is; a list of items is a list for a screen reader too.
  it('renders the tag the screen asks for, not a div with a role', () => {
    const view = mount(AppCard, {
      props: { as: 'ul', list: true },
      slots: { default: '<li>Milk</li><li>Bread</li>' },
    })
    expect(view.element.tagName).toBe('UL')
    expect(view.attributes('role')).toBeUndefined()
    expect(view.findAll('li')).toHaveLength(2)
    expect(view.classes()).toContain('list')
  })

  it.each(['article', 'section', 'ol'] as const)('can be an %s', (as) => {
    expect(mount(AppCard, { props: { as } }).element.tagName).toBe(as.toUpperCase())
  })

  // A card is a surface, never a control.
  it('must not fire: refuses to become a button', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mount(AppCard, { props: { as: 'button' as never } })
    expect(warn.mock.calls.some(([message]) => String(message).includes('Invalid prop'))).toBe(true)
  })

  it('draws the «take» card with its own edge', () => {
    expect(mount(AppCard, { props: { tone: 'take' } }).classes()).toContain('take')
  })

  // The verdict card's own padding comes from the screen's class.
  it('takes the class of the screen on its root', () => {
    expect(mount(AppCard, { attrs: { class: 'verdict' } }).classes()).toContain('verdict')
  })

  // «Take» is a verdict from the data, not emphasis: the accent never marks a card.
  it('never uses the accent', () => {
    expect(source.slice(source.indexOf('<style'))).not.toMatch(/--accent/)
  })
})
