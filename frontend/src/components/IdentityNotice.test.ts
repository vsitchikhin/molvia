import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
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
  return mount(IdentityNotice, { global: { plugins: [i18n] } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
})

describe('IdentityNotice', () => {
  it('says nothing while the identity is fine', () => {
    expect(render('ready').text()).toBe('')
  })

  it('tells the person their data is out of reach instead of showing an empty app', () => {
    // The owner chose this over silence when the plan was reviewed: an app that quietly
    // reappears empty looks broken, and the trips behind the old identifier are gone.
    const view = render('lost')

    expect(view.text()).toContain(en.identity.lost_title)
    expect(view.text()).toContain(en.identity.lost_body)
  })

  it('lets that message be dismissed: a new identity already works', async () => {
    const view = render('lost')

    await view.get('button').trigger('click')

    expect(view.text()).toBe('')
  })

  it('asks for the invite link, and offers nothing to dismiss', () => {
    // Nothing is behind this one to get on with, so a «got it» button would be a lie.
    const view = render('uninvited')

    expect(view.text()).toContain(en.identity.uninvited_title)
    expect(view.find('button').exists()).toBe(false)
  })

  it('takes every word from i18n, not from the markup', () => {
    // Not a single string lives in a template: the plan is other languages without a
    // rebrand, and hardcoded text is the cheapest mistake today, the dearest one later.
    const view = render('lost')

    expect(view.text()).not.toContain('identity.')
    expect(view.html()).not.toContain('Данные')
  })
})
