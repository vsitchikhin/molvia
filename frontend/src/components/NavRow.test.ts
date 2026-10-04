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
})
