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

    expect(view.text()).toContain(en.identity.lost.title)
    expect(view.text()).toContain(en.identity.lost.body)
  })

  it('lets that message be dismissed: a new identity already works', async () => {
    const { view } = render('lost')

    await view.get('button').trigger('click')

    expect(view.text()).toBe('')
  })

  it('does not stay silent when the identity could not be loaded at all', () => {
    // While it is not up, every request the app makes goes out without an owner — an app
    // that looked normal and could not save a thing was the worst of the options.
    expect(render('error').view.text()).toContain(en.identity.error.title)
    expect(render('offline').view.text()).toContain(en.identity.offline.title)
  })

  // Offline had a «Try again» of its own until MOL-19: under the screen's own offline it made
  // two buttons of one name doing different things, and the store comes back on `online` by
  // itself, as the text says. The owner took it away (MOL-19, Р-1).
  it('offers a retry only for an error, where the next attempt is the way out', async () => {
    const { view, store } = render('error')
    const retry = vi.spyOn(store, 'retry').mockResolvedValue(undefined)

    await view.get('button').trigger('click')

    expect(retry).toHaveBeenCalled()
    expect(render('offline').view.find('button').exists()).toBe(false)
  })

  it('offers to bring the old data back when there is something to bring back', async () => {
    // Keeping the identifier «so a server-side mistake stays recoverable» means nothing
    // until a person can act on it — and until then the message is simply untrue.
    const { view, store } = render('lost', { lost: [LOST_ID] })
    const restore = vi.spyOn(store, 'restore').mockResolvedValue(undefined)

    await view.get('button').trigger('click')

    expect(view.text()).toContain(en.identity.restore)
    expect(restore).toHaveBeenCalled()
  })

  it('does not offer it when nothing was set aside', () => {
    expect(render('lost').view.text()).not.toContain(en.identity.restore)
  })

  it('says so when the restore was refused, instead of leaving the press unanswered', () => {
    // The button is likeliest to be pressed right after the server refused, so «it did not
    // work, and nothing changed» is the outcome a person most needs spelled out.
    const { view } = render('lost', { lost: [LOST_ID], failed: true })

    expect(view.text()).toContain(en.identity.restore_failed)
    expect(view.text()).toContain(en.identity.restore)
  })

  // Until MOL-19 a lost identity interrupted. But the notice is drawn again over every screen,
  // and an interruption on every move cut off the heading the move had just focused. The owner
  // made every notice polite (MOL-19, Р-9).
  it('never interrupts: it is drawn again on every screen the person moves to', () => {
    for (const state of ['lost', 'error', 'offline'] as const) {
      expect(render(state).view.find('[role="alert"]').exists()).toBe(false)
    }
  })

  // Drawn by the shared screen state: an error is red like on any screen, offline is yellow
  // rather than the green of an offline trip — without an identity nothing can be saved. The
  // error is announced politely: the notice is drawn again on every screen the person moves
  // to, and an alert would cut off the heading each move focuses (MOL-19, A3).
  it.each([
    ['error', 'bad', 'status'],
    ['offline', 'warn', 'status'],
    ['lost', 'warn', 'status'],
  ] as const)('draws %s in %s and announces it as %s', (state, tone, role) => {
    const { view } = render(state)
    expect(view.get('.state').classes()).toContain(tone)
    expect(view.get('[role]').attributes('role')).toBe(role)
  })

  it('is never drawn red for a dropped connection', () => {
    expect(render('offline').view.get('.state').classes()).not.toContain('bad')
  })

  it('stays a landmark, so it can be reached among the page regions', () => {
    expect(render('error').view.element.tagName).toBe('ASIDE')
  })

  it('takes every word from i18n, not from the markup', () => {
    // Not a single string lives in a template: the plan is other languages without a
    // rebrand, and hardcoded text is the cheapest mistake today, the dearest one later.
    const { view } = render('lost')

    expect(view.text()).not.toContain('identity.')
    expect(view.html()).not.toContain('Данные')
  })
})
