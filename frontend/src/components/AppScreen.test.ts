import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, nextTick, ref, shallowRef, watch } from 'vue'
import type { AppLocale } from '@molvia/model'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { createAppI18n } from '@/i18n'
import AppScreen from '@/components/AppScreen.vue'
import { useActorStore } from '@/stores/actor'
import { routes } from '@/router'
import { pwaUpdateKey, type UpdatePhase } from '@/pwaUpdate'
import { provideAnnouncer } from '@/composables/useAnnouncer'

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
  options: {
    locale?: AppLocale
    slots?: Record<string, () => unknown>
    update?: UpdatePhase
  } = {},
) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  const view = mount(AppScreen, {
    props: { title: 'Trip' },
    slots: options.slots ?? {},
    global: {
      plugins: [router, createPinia(), createAppI18n(options.locale ?? 'en')],
      provide: {
        [pwaUpdateKey as symbol]: {
          phase: shallowRef(options.update ?? 'none'),
          apply: vi.fn(),
          serverVersion: vi.fn(),
        },
      },
    },
  })
  return { view, router }
}

beforeEach(() => {
  DrivenObserver.last = undefined
  vi.stubGlobal('IntersectionObserver', DrivenObserver)
  // happy-dom lays nothing out, so a measured back label would land on whatever its zeros
  // decide. Outside the tests that drive the measure, nothing is measured and the label is whole.
  vi.stubGlobal('ResizeObserver', undefined)
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

      await render('/purchases/manual/add')
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
  // Ф-29, К-10: one place for «Вернуть» on every screen, the frame's — 8 over the strip, which
  // stays under it whole. Where it lands is measured end to end; here, that it is its own block.
  describe('the place of «Вернуть»', () => {
    it('is not there when a screen has nothing to take back', async () => {
      const { view } = await render('/money')
      expect(view.find('.undo-place').exists()).toBe(false)
    })

    it('stands apart from the strip and the scroll, the strip still whole under it', async () => {
      const { view } = await render('/money', {
        slots: {
          docked: () => h('button', 'Добавить трату'),
          undo: () => h('div', { class: 'undo-strip' }, 'Удалено: кофе'),
        },
      })
      const place = view.get('.undo-place')
      expect(place.text()).toBe('Удалено: кофе')
      expect(view.get('.dock').element.contains(place.element)).toBe(false)
      expect(view.get('.content').element.contains(place.element)).toBe(false)
      expect(view.get('.dock').text()).toBe('Добавить трату')
      // Over the strip by its measured height: the frame says it is holding one.
      expect(view.classes()).toContain('held')
    })

    it('rises over a waiting version, which is a strip too, and stands without one', async () => {
      const undo = () => h('div', 'Удалено: кофе')
      const waiting = await render('/money', { update: 'ready', slots: { undo } })
      expect(waiting.view.classes()).toContain('held')
      const bare = await render('/money', { slots: { undo } })
      expect(bare.view.classes()).not.toContain('held')
    })
  })

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

    describe('a new version waiting (MOL-132, В-1)', () => {
      it('is the strip’s top row, over what the screen pins there', async () => {
        const { view } = await render('/', {
          update: 'ready',
          slots: { docked: () => h('p', { class: 'total' }, 'ИТОГО') },
        })
        const rows = view.get('.dock').element.children
        expect(rows[0]?.classList.contains('band')).toBe(true)
        expect(rows[1]?.classList.contains('total')).toBe(true)
        expect(view.get('.content').find('.dock-room').exists()).toBe(true)
      })

      it('brings the strip, and the room for it, to a screen that pins nothing', async () => {
        const { view } = await render('/', { update: 'ready' })
        expect(view.get('.dock').find('.band').exists()).toBe(true)
        expect(view.get('.content').find('.dock-room').exists()).toBe(true)
      })

      it('says the version out loud when it comes while the screen is open (adversarial Д1)', async () => {
        vi.useFakeTimers()
        const phase = shallowRef<UpdatePhase>('none')
        const said: string[] = []
        const router = createRouter({ history: createMemoryHistory(), routes })
        await router.push('/')
        // A plain component: `h` with the frame under the app's live region, as `App.vue` has it.
        const Root = {
          setup() {
            const announcements = provideAnnouncer()
            watch(announcements, (now, before) => {
              for (const added of now.filter((a) => !before.some((b) => b.id === a.id))) {
                said.push(added.text)
              }
            })
            return () => h(AppScreen, { title: 'Trip' })
          },
        }
        mount(Root, {
          global: {
            plugins: [router, createPinia(), createAppI18n('en')],
            provide: {
              [pwaUpdateKey as symbol]: { phase, apply: vi.fn(), serverVersion: vi.fn() },
            },
          },
        })

        phase.value = 'ready'
        await nextTick()
        vi.advanceTimersByTime(200)
        await nextTick()

        expect(said).toEqual(['A new version is out'])
        vi.useRealTimers()
      })

      it('must not bring a strip when nothing waits', async () => {
        const { view } = await render('/', { update: 'none' })
        expect(view.find('.dock').exists()).toBe(false)
        expect(view.find('.band').exists()).toBe(false)
      })
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
      for (const path of ['/', '/purchases', '/verdicts']) {
        const { view } = await render(path)
        expect(view.find('.back').exists()).toBe(false)
      }
    })

    it('is labelled with where it leads, not with the word «Back»', async () => {
      const { view } = await render('/purchases/manual')
      const back = view.get('.back')
      expect(back.text()).toContain(en.purchases.title)
      expect(view.get('.screen').classes()).toContain('docked')
    })

    // WCAG 2.5.3: the accessible name contains the visible label, so voice control finds
    // «Trip», and a screen reader still hears «Back» first.
    it.each([
      ['en', en],
      ['ru', ru],
    ] as const)('is named «Back, <parent>» in %s', async (locale, dictionary) => {
      const { view } = await render('/purchases/manual', { locale })
      const back = view.get('.back')
      expect(back.attributes('aria-label')).toBeUndefined()
      expect(back.text().replace(/\s+/g, ' ').trim()).toBe(
        `${dictionary.nav.back_label} ${dictionary.purchases.title}`,
      )
      expect(back.get('.hidden').text()).toBe(dictionary.nav.back_label)
    })

    describe('when its label does not fit (MOL-75)', () => {
      /** Sizes happy-dom does not lay out: the column, the labels and where the label starts. */
      const size = { column: 200, full: 0, short: 0 }

      /** Driven like the observer above: the test says «a size changed», the screen measures. */
      class DrivenResizeObserver {
        static all: DrivenResizeObserver[] = []
        readonly observed: Element[] = []
        constructor(readonly callback: ResizeObserverCallback) {
          DrivenResizeObserver.all.push(this)
        }
        /** The one the label is measured by, among the row's and the strip's. */
        static label(): DrivenResizeObserver | undefined {
          return DrivenResizeObserver.all.find((each) =>
            each.observed.some((node) => node.classList.contains('leading')),
          )
        }
        observe(target: Element): void {
          this.observed.push(target)
        }
        disconnect(): void {
          this.observed.length = 0
        }
        resize(): void {
          this.callback([], this as unknown as ResizeObserver)
        }
      }

      beforeEach(() => {
        Object.assign(size, { column: 200, full: 0, short: 0 })
        DrivenResizeObserver.all = []
        vi.stubGlobal('ResizeObserver', DrivenResizeObserver)
        // Every width in fractions, as the browser draws them (review А1). The chevron ends 26
        // into the button: that much of the column is never the label's.
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
          this: Element,
        ) {
          const inSamples = this.parentElement?.classList.contains('samples') ?? false
          const sample = this.nextElementSibling ? size.full : size.short
          const width = this.classList.contains('leading') ? size.column : inSamples ? sample : 0
          const right = this.classList.contains('chevron') ? 26 : width
          return { left: 0, right, width } as DOMRect
        })
      })

      const spoken = (view: Awaited<ReturnType<typeof render>>['view']): string =>
        view.get('.back').text().replace(/\s+/g, ' ').trim()

      it('says where it leads while that fits', async () => {
        Object.assign(size, { full: 145, short: 40 })
        const { view } = await render('/purchases/5a3c3c1e-0000-4000-8000-000000000001')
        expect(view.get('.back .label').text()).toBe(en.purchases.title)
        expect(spoken(view)).toBe(`${en.nav.back_label} ${en.purchases.title}`)
      })

      // Review Р-2, owner's decision: the name keeps where it leads on every step of the ladder,
      // the word shown first — «Back Purchases», not «Back» and not «Back Back».
      it('shows «Back» alone, and is still named where it leads', async () => {
        Object.assign(size, { column: 100, full: 145, short: 40 })
        const { view } = await render('/purchases/5a3c3c1e-0000-4000-8000-000000000001')
        expect(view.get('.back .label').text()).toBe(en.nav.back_label)
        expect(view.get('.back .hidden').text()).toBe(en.purchases.title)
        expect(spoken(view)).toBe(`${en.nav.back_label} ${en.purchases.title}`)
      })

      it('is the chevron alone, and still read out whole', async () => {
        Object.assign(size, { column: 60, full: 145, short: 40 })
        const { view } = await render('/purchases/5a3c3c1e-0000-4000-8000-000000000001', {
          locale: 'ru',
        })
        expect(view.find('.back .label').exists()).toBe(false)
        expect(view.findAll('.back .hidden')).toHaveLength(2)
        expect(spoken(view)).toBe(`${ru.nav.back_label} ${ru.purchases.title}`)
      })

      // The column narrows when the small title comes in and widens when it goes: the label
      // follows it both ways, not only the first time it is measured.
      it('measures again whenever the column or a label changes size', async () => {
        Object.assign(size, { full: 145, short: 40 })
        const { view } = await render('/purchases/5a3c3c1e-0000-4000-8000-000000000001')
        const observer = DrivenResizeObserver.label()
        expect(observer?.observed).toHaveLength(3)

        size.column = 60
        observer?.resize()
        await nextTick()
        expect(view.find('.back .label').exists()).toBe(false)

        size.column = 200
        observer?.resize()
        await nextTick()
        expect(view.get('.back .label').text()).toBe(en.purchases.title)
      })

      // «Назад» 51.06 wide in 51 of room: rounded, the word read 51 and «fit» by a fraction it
      // did not have — and «Наз…» was drawn. A tenth more room, and it does fit.
      it('decides in fractions, not in the whole pixels a browser rounds to', async () => {
        Object.assign(size, { column: 77, full: 145.2, short: 51.06 })
        const { view } = await render('/purchases/5a3c3c1e-0000-4000-8000-000000000001', {
          locale: 'ru',
        })
        expect(view.find('.back .label').exists()).toBe(false)

        size.column = 77.1
        DrivenResizeObserver.label()?.resize()
        await nextTick()
        expect(view.get('.back .label').text()).toBe(ru.nav.back_label)
      })

      // Nothing to hear a change by, so no measure to trust: the label is whole, and its
      // ellipsis keeps it inside the column.
      it('stays whole and measures nothing where the platform cannot observe a size', async () => {
        vi.stubGlobal('ResizeObserver', undefined)
        Object.assign(size, { column: 60, full: 145, short: 40 })
        const { view } = await render('/purchases/5a3c3c1e-0000-4000-8000-000000000001')
        expect(view.get('.back .label').text()).toBe(en.purchases.title)
        expect(spoken(view)).toBe(`${en.nav.back_label} ${en.purchases.title}`)
      })

      it('keeps no samples and observes nothing on a section', async () => {
        const { view } = await render('/advice')
        expect(view.find('.samples').exists()).toBe(false)
        expect(DrivenResizeObserver.label()).toBeUndefined()
      })
    })

    it('leads to the parent', async () => {
      const { view, router } = await render('/purchases/manual')
      await view.get('.back').trigger('click')
      await vi.waitFor(() => {
        expect(router.currentRoute.value.name).toBe('purchases')
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
