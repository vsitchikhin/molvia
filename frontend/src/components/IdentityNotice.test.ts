import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import IdentityNotice from '@/components/IdentityNotice.vue'
import { useActorStore } from '@/stores/actor'
import type { IdentityState } from '@/stores/actor'

const LOST_ID = '9f1b8c7d-4e2a-4b6f-8c3d-1a2b3c4d5e6f'

function render(state: IdentityState, options: { lost?: string[]; failed?: boolean } = {}) {
  const store = useActorStore()
  store.state = state
  store.lost = options.lost ?? []
  store.restoreFailed = options.failed ?? false

  // Через фабрику приложения, а не руками: собранный вручную i18n молча расходится с продом
  // (без `pluralRules` счётчик считает по-английски, без `fallbackLocale` пропущенный ключ
  // печатает своё имя вместо английского текста).
  const view = mount(IdentityNotice, { global: { plugins: [createAppI18n('en')] } })
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

  it('offers to bring the old data back when there is something to bring back', async () => {
    // Keeping the identifier «so a server-side mistake stays recoverable» means nothing
    // until a person can act on it — and until then the message is simply untrue.
    const { view, store } = render('lost', { lost: [LOST_ID] })
    const restore = vi.spyOn(store, 'restore').mockResolvedValue(undefined)

    await view.get('button').trigger('click')

    expect(view.text()).toContain(en.identity.lost_restore)
    expect(restore).toHaveBeenCalled()
  })

  it('does not offer it when nothing was set aside', () => {
    expect(render('lost').view.text()).not.toContain(en.identity.lost_restore)
  })

  it('says so when the restore was refused, instead of leaving the press unanswered', () => {
    // The button is likeliest to be pressed right after the server refused, so «it did not
    // work, and nothing changed» is the outcome a person most needs spelled out.
    const { view } = render('lost', { lost: [LOST_ID], failed: true })

    expect(view.text()).toContain(en.identity.lost_restore_failed)
    expect(view.text()).toContain(en.identity.lost_restore)
  })

  it('interrupts for a lost identity and stays polite for a dropped connection', () => {
    // A lost identity interrupts what someone was doing; no connection does not, and a
    // screen reader should be told the difference.
    expect(render('lost').view.get('aside').attributes('role')).toBe('alert')
    expect(render('offline').view.get('aside').attributes('role')).toBe('status')
  })

  it('takes every word from i18n, not from the markup', () => {
    // Not a single string lives in a template: the plan is other languages without a
    // rebrand, and hardcoded text is the cheapest mistake today, the dearest one later.
    const { view } = render('lost')

    expect(view.text()).not.toContain('identity.')
    expect(view.html()).not.toContain('Данные')
  })
})
