import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import IconDevices from '~icons/mdi/cellphone-link'
import NavRow from '@/components/NavRow.vue'

const stub = { render: () => null }

describe('NavRow', () => {
  it('with a destination, is a link the router follows', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: stub },
        { path: '/devices', name: 'devices', component: stub },
      ],
    })
    await router.push('/')
    const view = mount(NavRow, {
      props: { to: { name: 'devices' }, label: 'Устройства', value: '3', icon: IconDevices },
      global: { plugins: [router] },
    })
    expect(view.element.tagName).toBe('A')
    expect(view.attributes('href')).toBe('/devices')
    expect(view.attributes('aria-haspopup')).toBeUndefined()
    await view.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('devices')
  })

  // «Счёт · Наличные ›» opens the picker: a screen reader hears a dialog is coming.
  it('without one, is a button that says it opens a sheet', async () => {
    const view = mount(NavRow, { props: { label: 'Счёт', value: 'Наличные' } })
    expect(view.element.tagName).toBe('BUTTON')
    expect(view.attributes('type')).toBe('button')
    expect(view.attributes('aria-haspopup')).toBe('dialog')
    await view.trigger('click')
    expect(view.emitted('click')).toHaveLength(1)
  })

  it('reads «label · value» and always draws the chevron, hidden from a screen reader', () => {
    const view = mount(NavRow, { props: { label: 'Доходы', value: '120 000 ₽' } })
    expect(view.get('.label').text()).toBe('Доходы')
    expect(view.get('.value').text()).toBe('120 000 ₽')
    expect(view.get('.chevron').attributes('aria-hidden')).toBe('true')
  })

  it('draws no value it was not given', () => {
    expect(
      mount(NavRow, { props: { label: 'Устройства' } })
        .find('.value')
        .exists(),
    ).toBe(false)
  })

  // «Сегодня · без заметки ›» among the fields of a sheet (MOL-199, Ф-3): a field's well, not a list row.
  it('in a form, is drawn as a field and says when what is behind it is wrong', () => {
    const plain = mount(NavRow, { props: { label: 'Сегодня · без заметки' } })
    expect(plain.classes()).not.toContain('nav-field')
    expect(plain.attributes('aria-invalid')).toBeUndefined()
    const field = mount(NavRow, { props: { label: 'Сегодня · без заметки', field: true } })
    expect(field.classes()).toContain('nav-field')
    expect(field.attributes('aria-invalid')).toBeUndefined()
    const wrong = mount(NavRow, { props: { label: 'Сегодня · Обед', field: true, invalid: true } })
    expect(wrong.classes()).toContain('nav-invalid')
    expect(wrong.attributes('aria-invalid')).toBe('true')
  })
})
