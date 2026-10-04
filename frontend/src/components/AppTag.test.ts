import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import IconAlert from '~icons/mdi/alert-outline'
import AppTag from '@/components/AppTag.vue'

describe('AppTag', () => {
  it.each(['plain', 'warn', 'bad'] as const)('draws the %s tone', (tone) => {
    const view = mount(AppTag, { props: { tone }, slots: { default: 'Отправляем…' } })
    expect(view.element.tagName).toBe('SPAN')
    expect(view.classes()).toContain(tone)
    expect(view.text()).toBe('Отправляем…')
  })

  it('draws an icon only when given one, hidden from a screen reader', () => {
    expect(
      mount(AppTag, { slots: { default: 'сбережения' } })
        .find('.icon')
        .exists(),
    ).toBe(false)
    const view = mount(AppTag, { props: { icon: IconAlert }, slots: { default: 'Не принята' } })
    expect(view.get('.icon').attributes('aria-hidden')).toBe('true')
  })
})
