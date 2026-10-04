import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import SectionCaption from '@/components/SectionCaption.vue'

describe('SectionCaption', () => {
  it('is a heading of the outline unless the screen names another tag', () => {
    expect(mount(SectionCaption, { slots: { default: 'Аккаунт' } }).element.tagName).toBe('H2')
    for (const as of ['h3', 'p', 'span'] as const) {
      const view = mount(SectionCaption, { props: { as }, slots: { default: 'Аккаунт' } })
      expect(view.element.tagName).toBe(as.toUpperCase())
    }
  })

  // The combobox's list is named by its caption, and «Устройства» send the focus to theirs.
  it('puts an id and a tabindex on the tag itself', () => {
    const view = mount(SectionCaption, {
      attrs: { id: 'recent-heading', tabindex: '-1' },
      slots: { default: 'Недавние' },
    })
    expect(view.attributes('id')).toBe('recent-heading')
    expect(view.attributes('tabindex')).toBe('-1')
  })

  it('takes the focus when the screen gives it', () => {
    const view = mount(SectionCaption, {
      attrs: { tabindex: '-1' },
      slots: { default: 'Устройства' },
      attachTo: document.body,
    })
    ;(view.vm as unknown as { focus: () => void }).focus()
    expect(document.activeElement).toBe(view.element)
    view.unmount()
  })

  // «Сентябрь 120 000 ₽» is one heading: a screen reader reads the sum with the month.
  it('keeps the mark and the tail inside the heading, around the words', () => {
    const view = mount(SectionCaption, {
      slots: {
        default: 'Сентябрь',
        mark: () => h('i', { class: 'dot' }),
        tail: '120 000 ₽',
      },
    })
    const parts = view.element.children
    expect([...parts].map((part) => part.className)).toEqual(['mark', 'words', 'tail'])
    expect(view.text()).toBe('Сентябрь120 000 ₽')
  })

  it('draws neither a mark nor a tail it was not given', () => {
    const view = mount(SectionCaption, { slots: { default: 'Обмены' } })
    expect(view.find('.mark').exists()).toBe(false)
    expect(view.find('.tail').exists()).toBe(false)
  })

  it('marks the title of a card as inset', () => {
    expect(mount(SectionCaption, { props: { inset: true } }).classes()).toContain('inset')
    expect(mount(SectionCaption).classes()).not.toContain('inset')
  })
})
