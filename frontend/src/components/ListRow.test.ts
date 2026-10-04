import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import IconWallet from '~icons/mdi/wallet-outline'
import ListRow from '@/components/ListRow.vue'

const stub = { render: () => null }

async function routed() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: stub },
      { path: '/devices', name: 'devices', component: stub },
    ],
  })
  await router.push('/')
  return router
}

describe('ListRow', () => {
  it('is a button by default that never submits a form, with its title and meta', async () => {
    const view = mount(ListRow, { props: { title: 'Наличные', meta: 'На расходы' } })
    expect(view.element.tagName).toBe('BUTTON')
    expect(view.attributes('type')).toBe('button')
    expect(view.get('.title').text()).toBe('Наличные')
    expect(view.get('.meta').text()).toBe('На расходы')
    await view.trigger('click')
    expect(view.emitted('click')).toHaveLength(1)
  })

  it('draws no meta it was not given', () => {
    expect(
      mount(ListRow, { props: { title: 'Наличные' } })
        .find('.meta')
        .exists(),
    ).toBe(false)
  })

  // A row whose tail holds a button of its own: a button inside a button is no HTML.
  it('as a div, is no control and takes a button into its tail', () => {
    const view = mount(ListRow, {
      props: { as: 'div', title: 'iPhone · Safari' },
      slots: { tail: () => h('button', { class: 'end' }, 'Завершить') },
    })
    expect(view.element.tagName).toBe('DIV')
    expect(view.attributes('type')).toBeUndefined()
    expect(view.classes()).not.toContain('live')
    expect(view.get('.tail .end').text()).toBe('Завершить')
  })

  it('as a link, is an anchor that the router follows', async () => {
    const router = await routed()
    const view = mount(ListRow, {
      props: { as: 'router-link', to: { name: 'devices' }, title: 'Устройства', next: true },
      global: { plugins: [router] },
    })
    expect(view.element.tagName).toBe('A')
    expect(view.attributes('href')).toBe('/devices')
    await view.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('devices')
  })

  // В-14 «а»: the chevron is what the screen says the row opens, never the tag's guess.
  it('draws the chevron only when the row opens something to go on with', () => {
    expect(
      mount(ListRow, { props: { title: 'Скачать' } })
        .find('.chevron')
        .exists(),
    ).toBe(false)
    const next = mount(ListRow, { props: { title: 'Счёт', next: true } })
    expect(next.get('.chevron').attributes('aria-hidden')).toBe('true')
  })

  it('draws the icon it is given at its own step, hidden from a screen reader', () => {
    const view = mount(ListRow, { props: { title: 'Наличные', icon: IconWallet } })
    expect(view.get('.icon').attributes('aria-hidden')).toBe('true')
  })

  it('carries a tail beside the words', () => {
    const view = mount(ListRow, {
      props: { title: 'Наличные' },
      slots: { tail: '42 300 ֏' },
    })
    expect(view.get('.tail').text()).toBe('42 300 ֏')
  })

  describe('inactive (Ф-6)', () => {
    it('stays in the focus order, says it is not now, and its press reaches nobody', async () => {
      const above = vi.fn()
      const wrapper = mount({
        render: () =>
          h('div', { onClick: above }, [h(ListRow, { title: 'Скачать', inactive: true })]),
      })
      const row = wrapper.get('button')
      expect(row.attributes('disabled')).toBeUndefined()
      expect(row.attributes('aria-disabled')).toBe('true')
      await row.trigger('click')
      expect(wrapper.findComponent(ListRow).emitted('click')).toBeUndefined()
      expect(above).not.toHaveBeenCalled()
    })

    it('as a link, is followed nowhere', async () => {
      const router = await routed()
      const view = mount(ListRow, {
        props: { as: 'router-link', to: { name: 'devices' }, title: 'Устройства', inactive: true },
        global: { plugins: [router] },
      })
      expect(view.attributes('aria-disabled')).toBe('true')
      // No address to take: a middle click or a long press would open it in a tab (review 1).
      expect(view.attributes('href')).toBeUndefined()
      expect(view.attributes('role')).toBe('link')
      expect(view.attributes('tabindex')).toBe('0')
      await view.trigger('click')
      await flushPromises()
      expect(router.currentRoute.value.path).toBe('/')
    })

    it('says nothing of it on a row that is no control', () => {
      const view = mount(ListRow, { props: { as: 'div', title: 'Скачать', inactive: true } })
      expect(view.attributes('aria-disabled')).toBeUndefined()
    })
  })

  describe('selected (Ф-5)', () => {
    it('is read out as checked in a radio group, and the ✓ takes the chevron’s place', () => {
      const view = mount(ListRow, {
        props: { title: 'Карта', selected: true, next: true },
        attrs: { role: 'radio' },
      })
      expect(view.attributes('aria-checked')).toBe('true')
      expect(view.attributes('aria-selected')).toBeUndefined()
      expect(view.find('.check').exists()).toBe(true)
      expect(view.find('.chevron').exists()).toBe(false)
    })

    it('is read out as not checked when another is chosen', () => {
      const view = mount(ListRow, { props: { title: 'Наличные' }, attrs: { role: 'radio' } })
      expect(view.attributes('aria-checked')).toBe('false')
    })

    it('is read out as selected in a listbox', () => {
      const view = mount(ListRow, {
        props: { as: 'div', title: 'Молоко', selected: true },
        attrs: { role: 'option' },
      })
      expect(view.attributes('aria-selected')).toBe('true')
      expect(view.attributes('aria-checked')).toBeUndefined()
    })

    it('names no state on a row with no role to carry it, and says so while developing', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const view = mount(ListRow, { props: { title: 'Карта', selected: true } })
      expect(view.attributes('aria-checked')).toBeUndefined()
      expect(view.attributes('aria-selected')).toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()
      warn.mockRestore()
    })

    it('stays quiet when the role carries the choice', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      mount(ListRow, { props: { title: 'Карта', selected: true }, attrs: { role: 'radio' } })
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  it('marks the row the keyboard stands on, the destroying one, the wrapping title', () => {
    expect(mount(ListRow, { props: { active: true } }).classes()).toContain('active')
    expect(mount(ListRow, { props: { danger: true } }).classes()).toContain('danger')
    expect(mount(ListRow, { props: { wrap: true } }).classes()).toContain('wrap')
  })
})
