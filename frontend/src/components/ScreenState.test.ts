import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import IconPlus from '~icons/mdi/plus'
import IconAlert from '~icons/mdi/alert-circle-outline'
import IconCloudOff from '~icons/mdi/cloud-off-outline'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import type { AppLocale } from '@/i18n/locale'
import ScreenState from '@/components/ScreenState.vue'

type Props = Record<string, unknown>

function render(props: Props, slots: Record<string, () => unknown> = {}, locale: AppLocale = 'en') {
  return mount(ScreenState, {
    props: { title: 'Title', ...props } as never,
    slots,
    global: { plugins: [createAppI18n(locale)] },
  })
}

function refused(props: Props): boolean {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  render(props)
  const result = warn.mock.calls.some(([message]) => String(message).includes('Invalid prop'))
  warn.mockRestore()
  return result
}

describe('ScreenState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('each kind draws its own circle', () => {
    it('empty: the icon the screen brought, in the tone it chose', () => {
      const view = render({ kind: 'empty', tone: 'accent', icon: IconPlus })
      expect(view.findComponent(IconPlus).exists()).toBe(true)
      expect(view.classes()).toContain('accent')
    })

    it('empty that is a success is green', () => {
      const view = render({ kind: 'empty', tone: 'good', icon: IconPlus })
      expect(view.classes()).toContain('good')
    })

    it('error: always the alert icon, always red', () => {
      const view = render({ kind: 'error' })
      expect(view.findComponent(IconAlert).exists()).toBe(true)
      expect(view.classes()).toContain('bad')
    })

    it.each(['good', 'warn'])('offline: the cloud, in %s', (tone) => {
      const view = render({ kind: 'offline', tone })
      expect(view.findComponent(IconCloudOff).exists()).toBe(true)
      expect(view.classes()).toContain(tone)
    })

    it('attention: the alert icon, yellow — something to know, not a failure', () => {
      const view = render({ kind: 'attention' })
      expect(view.findComponent(IconAlert).exists()).toBe(true)
      expect(view.classes()).toContain('warn')
    })
  })

  // «Offline is never red» is a rule of the handoff that nobody could check by eye across
  // twelve cards; here no combination of props produces it.
  it('never draws offline red, whatever it is given', () => {
    for (const tone of ['accent', 'good', 'warn', 'bad', undefined]) {
      const view = render({ kind: 'offline', tone })
      expect(view.classes()).not.toContain('bad')
    }
  })

  describe('refuses what the types cannot say', () => {
    it.each<[string, Props]>([
      ['offline in red', { kind: 'offline', tone: 'bad' }],
      ['offline with no tone', { kind: 'offline' }],
      ['offline in accent', { kind: 'offline', tone: 'accent' }],
      ['empty with no icon', { kind: 'empty', tone: 'accent' }],
      ['empty with no tone', { kind: 'empty', icon: IconPlus }],
      ['empty in yellow', { kind: 'empty', tone: 'warn', icon: IconPlus }],
      ['error with a tone', { kind: 'error', tone: 'good' }],
      ['error with an icon of its own', { kind: 'error', icon: IconPlus }],
      ['attention with a tone', { kind: 'attention', tone: 'good' }],
      ['offline with an icon of its own', { kind: 'offline', tone: 'good', icon: IconPlus }],
      ['a kind that does not exist', { kind: 'loading' }],
      // `in` walks the prototype: «toString» passed for a kind with a fixed tone (MOL-19, A5).
      ['a name off the prototype', { kind: 'toString' }],
    ])('%s', (_, props) => {
      expect(refused(props)).toBe(true)
    })

    it.each<[string, Props]>([
      ['empty', { kind: 'empty', tone: 'accent', icon: IconPlus }],
      ['error', { kind: 'error' }],
      ['offline', { kind: 'offline', tone: 'warn' }],
      ['attention', { kind: 'attention' }],
    ])('and accepts %s as the handoff draws it', (_, props) => {
      expect(refused(props)).toBe(false)
    })
  })

  describe('speaks to a screen reader', () => {
    it.each([
      ['error', { kind: 'error' }, 'alert'],
      ['attention', { kind: 'attention' }, 'alert'],
      ['attention inline', { kind: 'attention', inline: true }, 'alert'],
      ['empty', { kind: 'empty', tone: 'accent', icon: IconPlus }, 'status'],
      ['offline', { kind: 'offline', tone: 'good' }, 'status'],
      // A notice drawn again over every screen: an alert would cut off the heading each move
      // has just focused (MOL-19, A3).
      ['inline error', { kind: 'error', inline: true }, 'status'],
    ])('%s is announced as %s', (_, props, role) => {
      expect(render(props).get('[role]').attributes('role')).toBe(role)
    })

    // Read out with its buttons, the card would announce «Try again» as if it were the news.
    it('keeps the buttons out of what it announces', () => {
      const view = render(
        { kind: 'error', body: 'Body' },
        { action: () => h('a', 'Take from recent') },
      )
      const region = view.get('[role]')
      expect(region.find('button').exists()).toBe(false)
      expect(region.find('a').exists()).toBe(false)
      expect(region.text()).toContain('Title')
      expect(region.text()).toContain('Body')
    })

    // The circle is decoration: the title and the text say what happened.
    it('hides the circle, and reads the title as a heading', () => {
      const view = render({ kind: 'error', title: 'The server did not answer' })
      expect(view.get('.circle').attributes('aria-hidden')).toBe('true')
      expect(view.get('h2').text()).toBe('The server did not answer')
    })
  })

  it('draws the title and the text it was given, as given', () => {
    const view = render({
      kind: 'offline',
      tone: 'good',
      title: ru.trip.offline.title,
      body: ru.trip.offline.body,
    })
    expect(view.get('.title').text()).toBe(ru.trip.offline.title)
    expect(view.get('.body').text()).toBe(ru.trip.offline.body)
  })

  // «Stale since yesterday» on the advice scaffold has a title only: its text names data
  // the scaffold does not have.
  it('leaves out the text when there is none', () => {
    expect(render({ kind: 'offline', tone: 'warn' }).find('.body').exists()).toBe(false)
  })

  // The handoff's fifth kind, arriving as a string: warned about, and drawn rather than thrown.
  it('draws a kind it does not know in a tone, instead of failing the screen', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const view = render({ kind: 'loading', tone: 'good' })
    expect(view.classes()).toContain('warn')
  })

  describe('«Try again»', () => {
    it('is offered by every error, and reported rather than acted on', async () => {
      const view = render({ kind: 'error' })
      const button = view.get('.action button')
      expect(button.text()).toBe(en.state.retry)

      await button.trigger('click')
      expect(view.emitted('retry')).toHaveLength(1)
    })

    // The button is replaced by a skeleton the moment it is pressed; left alone, the focus
    // falls to <body> and a screen reader starts the page over (MOL-19, A2).
    it('hands the focus to the screen heading before it goes', async () => {
      const heading = document.createElement('h1')
      heading.tabIndex = -1
      document.body.append(heading)
      const view = render({ kind: 'error' }, {})
      await view.get('.action button').trigger('click')
      expect(document.activeElement).toBe(heading)
      heading.remove()
    })

    it('says it in Russian from the same dictionary', () => {
      expect(render({ kind: 'error' }, {}, 'ru').get('.action button').text()).toBe(ru.state.retry)
    })

    // The search's error has a second way out — «Take from recent» — under the retry.
    it('comes first when the screen brings an action of its own', () => {
      const view = render({ kind: 'error' }, { action: () => h('a', 'Take from recent') })
      const children = [...view.get('.action').element.children].map((child) => child.tagName)
      expect(children).toEqual(['BUTTON', 'A'])
    })

    it.each<[string, Props]>([
      ['empty', { kind: 'empty', tone: 'accent', icon: IconPlus }],
      ['offline', { kind: 'offline', tone: 'good' }],
      ['attention', { kind: 'attention' }],
    ])('is not offered by %s, where trying again is not the way out', (_, props) => {
      expect(render(props).find('.action').exists()).toBe(false)
    })
  })

  it('puts the action at the end, and draws no empty row without one', () => {
    const withAction = render(
      { kind: 'empty', tone: 'accent', icon: IconPlus },
      { action: () => h('button', 'Find an item') },
    )
    expect(withAction.element.lastElementChild?.className).toBe('action')
    expect(withAction.get('.action').text()).toBe('Find an item')

    // The rating saved offline: nothing to do, nothing offered.
    expect(render({ kind: 'offline', tone: 'good' }).find('.action').exists()).toBe(false)
  })

  it('puts what the default slot brings under the text, before the action', () => {
    const view = render(
      { kind: 'attention', body: 'Body' },
      { default: () => h('p', 'Extra'), action: () => h('button', 'Act') },
    )
    const order = [...view.element.children].map((child) => child.className)
    expect(order.slice(-2)).toEqual(['extra', 'action'])
  })

  it('takes the free height unless it is asked to stay inline', () => {
    expect(render({ kind: 'error' }).classes()).not.toContain('inline')
    expect(render({ kind: 'error', inline: true }).classes()).toContain('inline')
  })
})
