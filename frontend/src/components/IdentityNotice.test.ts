import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import en from '@/i18n/en.json'
import IdentityNotice from '@/components/IdentityNotice.vue'
import { useActorStore } from '@/stores/actor'
import type { IdentityState } from '@/stores/actor'

function render(state: IdentityState) {
  const store = useActorStore()
  store.state = state

  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en } })
  const view = mount(IdentityNotice, { global: { plugins: [i18n] } })
  return { view, store }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('IdentityNotice', () => {
  it('says nothing while the identity is fine', () => {
    expect(render('ready').view.text()).toBe('')
    expect(render('loading').view.text()).toBe('')
  })

  it('tells the person their data is out of reach instead of showing an empty app', () => {
    // The owner chose this over silence when the plan was reviewed: an app that quietly
    // reappears empty looks broken, and the trips behind the old identifier are gone.
    const { view } = render('lost')

    expect(view.text()).toContain(en.identity.lost_title)
    expect(view.text()).toContain(en.identity.lost_body)
  })

  it('lets that message be dismissed: a new identity already works', async () => {
    const { view } = render('lost')

    await view.get('button').trigger('click')

    expect(view.text()).toBe('')
  })

  it('asks for the invite link, and offers nothing to dismiss', () => {
    // Nothing is behind this one to get on with, so a «got it» button would be a lie.
    const { view } = render('uninvited')

    expect(view.text()).toContain(en.identity.uninvited_title)
    expect(view.find('button').exists()).toBe(false)
  })

  it('does not stay silent when the identity could not be loaded at all', () => {
    // While it is not up, every request the app makes goes out without an owner — an app
    // that looked normal and could not save a thing was the worst of the options.
    expect(render('error').view.text()).toContain(en.identity.error_title)
    expect(render('offline').view.text()).toContain(en.identity.offline_title)
  })

  it('offers a retry in exactly the two states where trying again can work', async () => {
    const { view, store } = render('error')
    const retry = vi.spyOn(store, 'retry').mockResolvedValue(undefined)

    await view.get('button').trigger('click')

    expect(retry).toHaveBeenCalled()
    expect(render('offline').view.find('button').exists()).toBe(true)
    expect(render('uninvited').view.find('button').exists()).toBe(false)
  })

  it('takes every word from i18n, not from the markup', () => {
    // Not a single string lives in a template: the plan is other languages without a
    // rebrand, and hardcoded text is the cheapest mistake today, the dearest one later.
    const { view } = render('lost')

    expect(view.text()).not.toContain('identity.')
    expect(view.html()).not.toContain('Данные')
  })
})
