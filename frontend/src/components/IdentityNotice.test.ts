import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import IconWallet from '~icons/mdi/wallet-outline'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import BottomSheet from '@/components/BottomSheet.vue'
import IdentityNotice from '@/components/IdentityNotice.vue'
import ScreenSkeleton from '@/components/ScreenSkeleton.vue'
import ScreenState from '@/components/ScreenState.vue'
import SkeletonPart from '@/components/SkeletonPart.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import { provideAnswerWord } from '@/composables/useAnswerWord'
import { useActorStore } from '@/stores/actor'
import type { IdentityState } from '@/stores/actor'

function render(state: IdentityState) {
  const store = useActorStore()
  store.state = state

  // Через фабрику приложения, а не руками: собранный вручную i18n молча расходится с продом
  // (без `pluralRules` счётчик считает по-английски, без `fallbackLocale` пропущенный ключ
  // печатает своё имя вместо английского текста).
  const view = mount(IdentityNotice, { global: { plugins: [createAppI18n('en')] } })
  return { view, store }
}

/**
 * A frame as `AppScreen` is one: it provides the screen's word, draws the notice first and the
 * screen's content after it — what the content says is the case under test.
 */
function framed(content: () => ReturnType<typeof h> | null) {
  const Frame = defineComponent({
    setup() {
      provideAnswerWord()
      return () => h('div', [h(IdentityNotice), content()])
    },
  })
  // A sheet needs the router: its entry in the history is the router's own (MOL-80).
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: Frame }],
  })
  return mount(Frame, {
    global: { plugins: [pinia, router, createAppI18n('en')] },
    attachTo: document.body,
  })
}

let pinia = createPinia()

beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  localStorage.clear()
})

describe('IdentityNotice', () => {
  it('says nothing while the identity is fine', () => {
    expect(render('ready').view.text()).toBe('')
    expect(render('loading').view.text()).toBe('')
  })

  it('says the app works with no connection where nothing else says it', () => {
    expect(render('offline').view.text()).toContain(en.identity.offline.title)
  })

  // MOL-349, owner's В-2 «б» (kit-settings-7): the quiet card «Не удалось проверить вход» brought a
  // «Повторить» of its own over the screen's error and its «Повторить». The identity asks again by
  // itself (`actor.test`), and the screen's error is the one word.
  it('draws nothing for an identity that could not be checked', () => {
    const { view } = render('error')
    expect(view.text()).toBe('')
    expect(view.find('button').exists()).toBe(false)
    expect(en.identity).not.toHaveProperty('error')
  })

  // MOL-349, owner's В-1 «б» (С-2): over the screen's own «нет связи» the notice made two clouds, and
  // on «Что брать» stood over the field that chooses the answer.
  describe('says nothing where the screen says itself what became of its answer', () => {
    it.each([
      ['its offline state', () => h(ScreenState, { kind: 'offline', title: 'No connection' })],
      [
        'an error, a section’s too',
        () => h(ScreenState, { kind: 'error', inline: true, title: 'Failed' }),
      ],
      [
        'a strip of the connection',
        () => h(StatusStrip, { kind: 'offline', text: 'Offline · as of 14:05' }),
      ],
      [
        'its skeleton, the answer on its way',
        () => h(ScreenSkeleton, () => h(SkeletonPart, { kind: 'caption' })),
      ],
    ])('%s', async (_, content) => {
      useActorStore().state = 'offline'
      const view = framed(content)
      await nextTick()
      expect(view.find('.notice').exists()).toBe(false)
      view.unmount()
    })

    it('and speaks again once the screen’s word is gone', async () => {
      useActorStore().state = 'offline'
      const speaking = ref(true)
      const view = framed(() =>
        speaking.value ? h(ScreenState, { kind: 'offline', title: 'No connection' }) : null,
      )
      await nextTick()
      expect(view.find('.notice').exists()).toBe(false)
      speaking.value = false
      await nextTick()
      expect(view.find('.notice').exists()).toBe(true)
      view.unmount()
    })

    it('must not fire: an empty state, or attention, is no word about the connection', async () => {
      useActorStore().state = 'offline'
      const view = framed(() =>
        h('div', [
          h(ScreenState, { kind: 'attention', title: 'Mind this' }),
          h(ScreenState, { kind: 'empty', icon: IconWallet, title: 'Nothing yet' }),
        ]),
      )
      await nextTick()
      expect(view.find('.notice').text()).toContain(en.identity.offline.title)
      view.unmount()
    })

    // A sheet is mounted shut with its screen: its «Нет связи» is no word of the screen's.
    it('must not fire: a state inside a sheet does not speak for the screen', async () => {
      useActorStore().state = 'offline'
      const view = framed(() =>
        h(BottomSheet, { open: false, title: 'Where are you?' }, () =>
          h(ScreenState, { kind: 'offline', title: 'No connection' }),
        ),
      )
      await nextTick()
      expect(view.find('.notice').exists()).toBe(true)
      view.unmount()
    })
  })

  // Until MOL-19 a lost identity interrupted. But the notice is drawn again over every screen,
  // and an interruption on every move cut off the heading the move had just focused. The owner
  // made every notice polite (MOL-19, Р-9).
  it('never interrupts: it is drawn again on every screen the person moves to', () => {
    expect(render('offline').view.find('[role="alert"]').exists()).toBe(false)
  })

  // Yellow rather than the green of an offline trip — without an identity nothing can be saved —
  // and never red for a dropped connection.
  it('draws offline in warn, never red, with no button', () => {
    const { view } = render('offline')
    expect(view.get('.state').classes()).toContain('warn')
    expect(view.get('.state').classes()).not.toContain('bad')
    expect(view.find('button').exists()).toBe(false)
  })

  it('stays a landmark, so it can be reached among the page regions', () => {
    expect(render('offline').view.element.tagName).toBe('ASIDE')
  })

  it('takes every word from i18n, not from the markup', () => {
    // Not a single string lives in a template: the plan is other languages without a
    // rebrand, and hardcoded text is the cheapest mistake today, the dearest one later.
    const { view } = render('offline')

    expect(view.text()).not.toContain('identity.')
    expect(view.html()).not.toContain('Работаем')
  })

  // MOL-53 сняло состояние `lost` вместе с миром, который оно описывало: ключ держало
  // устройство, поэтому его потеря была потерей данных. Сессия — не данные, и «войдите заново»
  // рисует MOL-56 вместе с экраном, который умеет это сделать.
  it('has no notice left for a session that ended: that screen is MOL-56’s', () => {
    expect(en.identity).not.toHaveProperty('lost')
    expect(en.identity).not.toHaveProperty('restore')
  })
})
