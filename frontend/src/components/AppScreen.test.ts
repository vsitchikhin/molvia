import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { AppLocale } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import AppScreen from '@/components/AppScreen.vue'
import { useActorStore } from '@/stores/actor'
import { routes } from '@/router'

/**
 * happy-dom lays nothing out, so no observer ever fires on its own. This one is driven by the
 * test: it says «the sentinel has gone above the row» and the screen answers. The geometry
 * itself — 23px open, 25px collapsed — is measured end to end, in a real browser.
 */
class DrivenObserver {
  static last: DrivenObserver | undefined
  readonly options: IntersectionObserverInit | undefined
  disconnected = false
  observed: Element | undefined
  private readonly callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback
    this.options = options
    DrivenObserver.last = this
  }

  observe(target: Element): void {
    this.observed = target
  }
  disconnect(): void {
    this.disconnected = true
  }

  /** `top` is where the sentinel is, against a row whose bottom edge is at 44. */
  report(top: number): void {
    const entry = {
      isIntersecting: top >= 44,
      boundingClientRect: { top },
      rootBounds: { top: 44 },
    } as unknown as IntersectionObserverEntry
    this.callback([entry], this as unknown as IntersectionObserver)
  }
}

async function render(
  path: string,
  options: { locale?: AppLocale; slots?: Record<string, () => unknown> } = {},
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(AppScreen, {
    props: { title: 'Trip' },
    slots: options.slots ?? {},
    global: { plugins: [router, createPinia(), createAppI18n(options.locale ?? 'en')] },
  })
  return { view, router }
}

beforeEach(() => {
  DrivenObserver.last = undefined
  vi.stubGlobal('IntersectionObserver', DrivenObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AppScreen', () => {
  it('titles the screen with one heading, focusable for the router to land on', async () => {
    const { view } = await render('/')
    const heading = view.get('h1')
    expect(heading.text()).toBe('Trip')
    expect(heading.attributes('tabindex')).toBe('-1')
    expect(view.findAll('h1')).toHaveLength(1)
  })

  // The large title stays in the page when it scrolls away, so a screen reader finds it there;
  // the small copy in the row would otherwise be read a second time.
  it('keeps the small title in the row away from screen readers', async () => {
    const { view } = await render('/')
    expect(view.get('.small').attributes('aria-hidden')).toBe('true')
  })

  describe('collapsing', () => {
    it('watches the line under the pinned row, not the scroll position', async () => {
      await render('/')
      expect(DrivenObserver.last?.options?.rootMargin).toMatch(/^-\d+px 0px 0px 0px$/)
      expect(DrivenObserver.last?.observed?.classList.contains('sentinel')).toBe(true)
    })

    it('collapses once the sentinel is above the row, and opens again on the way back', async () => {
      const { view } = await render('/', { slots: { meta: () => 'Yerevan City · today' } })
      const screen = view.get('.screen')

      DrivenObserver.last?.report(43)
      await nextTick()
      expect(screen.classes()).toContain('collapsed')
      expect(view.get('.meta').attributes('aria-hidden')).toBe('true')

      DrivenObserver.last?.report(60)
      await nextTick()
      expect(screen.classes()).not.toContain('collapsed')
      expect(view.get('.meta').attributes('aria-hidden')).toBeUndefined()
    })

    // A sentinel out of view below the fold is not a title scrolled away.
    it('does not collapse for a sentinel that is out of view below', async () => {
      const { view } = await render('/')
      const observer = DrivenObserver.last
      const below = {
        isIntersecting: false,
        boundingClientRect: { top: 900 },
        rootBounds: { top: 44 },
      } as unknown as IntersectionObserverEntry
      ;(observer as unknown as { callback: IntersectionObserverCallback }).callback(
        [below],
        observer as unknown as IntersectionObserver,
      )
      await nextTick()
      expect(view.get('.screen').classes()).not.toContain('collapsed')
    })

    it('lets go of the observer when the screen leaves', async () => {
      const { view } = await render('/')
      const observer = DrivenObserver.last
      view.unmount()
      expect(observer?.disconnected).toBe(true)
    })

    it('stays open where the platform has no observer', async () => {
      vi.stubGlobal('IntersectionObserver', undefined)
      const { view } = await render('/')
      expect(view.get('.screen').classes()).not.toContain('collapsed')
    })
  })

  describe('the pinned row', () => {
    // The trip's place and «Finish» come with the trip, from the API, after the screen is up.
    it('pins a row that is filled after mount, and it stays alive', async () => {
      const router = createRouter({ history: createMemoryHistory(), routes })
      await router.push('/')
      const loaded = ref(false)
      const Trip = defineComponent(
        () => () =>
          h(
            AppScreen,
            { title: 'Trip' },
            loaded.value
              ? {
                  meta: () => 'Yerevan City · today',
                  trailing: () => h('button', { class: 'finish' }, 'Finish'),
                }
              : {},
          ),
      )
      const view = mount(Trip, {
        global: { plugins: [router, createPinia(), createAppI18n('en')] },
      })
      expect(view.get('.screen').classes()).not.toContain('docked')

      loaded.value = true
      await nextTick()
      expect(view.get('.meta').text()).toBe('Yerevan City · today')
      expect(view.get('.screen').classes()).toContain('docked')
    })

    // A turned phone moves the notch, and the row's height with it: the line follows.
    it('sets the observer up again when the row changes height', async () => {
      let height = 91
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height)
      let resized: (() => void) | undefined
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(callback: () => void) {
            resized = callback
          }
          observe(): void {
            // driven by the test
          }
          disconnect(): void {
            // nothing to let go
          }
        },
      )

      await render('/trip/add')
      await nextTick()
      expect(DrivenObserver.last?.options?.rootMargin).toBe('-91px 0px 0px 0px')
      const first = DrivenObserver.last

      height = 44
      resized?.()
      await nextTick()
      expect(first?.disconnected).toBe(true)
      expect(DrivenObserver.last?.options?.rootMargin).toBe('-44px 0px 0px 0px')
    })

    // «What to buy» and «Ratings» have nothing to put there: the row takes no room at rest.
    it('is not docked on a section with nothing in the row', async () => {
      const { view } = await render('/advice')
      expect(view.get('.screen').classes()).not.toContain('docked')
    })

    it('is docked when the screen puts its place or its actions there', async () => {
      const meta = await render('/', { slots: { meta: () => 'Yerevan City · today' } })
      expect(meta.view.get('.screen').classes()).toContain('docked')
      const trailing = await render('/', { slots: { trailing: () => h('button', 'Finish') } })
      expect(trailing.view.get('.screen').classes()).toContain('docked')
    })
  })

  // MOL-22, Н-1: полосу итога рисует фрейм, потому что место под ней — его забота. Высота
  // меряется в живом браузере (e2e), здесь — что полоса есть, пуста по умолчанию и что место
  // под неё контент просит переменной.
  describe('the docked strip', () => {
    it('is not there at all when a screen has nothing to pin', async () => {
      const { view } = await render('/')
      expect(view.find('.dock').exists()).toBe(false)
      expect(view.find('.dock-room').exists()).toBe(false)
    })

    it('holds what the screen puts there, over the page and outside the scroll', async () => {
      const { view } = await render('/', { slots: { docked: () => h('p', 'ИТОГО 6 493,12 ֏') } })
      const dock = view.get('.dock')
      expect(dock.text()).toBe('ИТОГО 6 493,12 ֏')
      // Над контентом, а не внутри него: иначе полоса уезжала бы с прокруткой. Место под неё
      // при этом внутри — последняя строка списка должна доставаться пальцем.
      expect(view.get('.content').element.contains(dock.element)).toBe(false)
      expect(view.get('.content').find('.dock-room').exists()).toBe(true)
    })

    it('appears with the trip it belongs to, not only on mount', async () => {
      const shown = ref(false)
      const view = mount(
        defineComponent({
          components: { AppScreen },
          setup: () => ({ shown }),
          template:
            '<AppScreen title="Trip"><template v-if="shown" #docked>ИТОГО</template></AppScreen>',
        }),
        {
          global: {
            plugins: [
              createRouter({ history: createMemoryHistory(), routes }),
              createPinia(),
              createAppI18n('en'),
            ],
          },
        },
      )
      expect(view.find('.dock').exists()).toBe(false)

      shown.value = true
      await nextTick()
      expect(view.get('.dock').text()).toBe('ИТОГО')
    })
  })

  describe('the back chevron', () => {
    it('is absent on a section', async () => {
      for (const path of ['/', '/advice', '/verdicts']) {
        const { view } = await render(path)
        expect(view.find('.back').exists()).toBe(false)
      }
    })

    it('is labelled with where it leads, not with the word «Back»', async () => {
      const { view } = await render('/trip/add')
      const back = view.get('.back')
      expect(back.text()).toContain(en.nav.trip)
      expect(view.get('.screen').classes()).toContain('docked')
    })

    // WCAG 2.5.3: the accessible name contains the visible label, so voice control finds
    // «Trip», and a screen reader still hears «Back» first.
    it.each([
      ['en', en],
      ['ru', ru],
    ] as const)('is named «Back, <parent>» in %s', async (locale, dictionary) => {
      const { view } = await render('/trip/add', { locale })
      const back = view.get('.back')
      expect(back.attributes('aria-label')).toBeUndefined()
      expect(back.text().replace(/\s+/g, ' ').trim()).toBe(
        `${dictionary.nav.back_label} ${dictionary.nav.trip}`,
      )
      expect(back.get('.hidden').text()).toBe(dictionary.nav.back_label)
    })

    it('leads to the parent', async () => {
      const { view, router } = await render('/trip/add')
      await view.get('.back').trigger('click')
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('trip')
      })
    })
  })

  it('shows the identity notice under the title, not above the row', async () => {
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const view = mount(
      defineComponent(() => () => h(AppScreen, { title: 'Trip' })),
      { global: { plugins: [router, pinia, createAppI18n('en')] } },
    )
    useActorStore(pinia).state = 'error'
    await nextTick()
    const order = [...view.element.querySelectorAll('.head, .notice, .content')].map((node) =>
      ['head', 'notice', 'content'].find((name) => node.classList.contains(name)),
    )
    expect(order).toEqual(['head', 'notice', 'content'])
  })
})
