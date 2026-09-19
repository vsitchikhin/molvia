import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import BottomSheet from '@/components/BottomSheet.vue'
import { routes } from '@/router'

/**
 * happy-dom runs the router on a memory history: a step back reaches the sheet at once and no
 * `popstate` ever fires, so the navigation's «a step is in flight» guard is released by hand
 * between steps — in a browser the pop does that. What the dialog itself does — the focus trap,
 * Esc, the scrim, focus coming back — is the browser's, and is checked end to end.
 */
function landed(): void {
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
}

/**
 * The sheet ignores a tap that closes while it is still coming up (the second of a double tap).
 * The clock is the test's: it stands still until a test lets time pass.
 */
let clock = 0

function wait(ms: number): void {
  clock += ms
}

/**
 * Real time, a few milliseconds of it. Vue drops an event that reaches a handler created in the
 * same millisecond the event began — its guard against handlers attached mid-dispatch — and a
 * test that mounts and taps at once hit it now and then. No finger taps that fast.
 */
async function realTime(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

beforeEach(() => {
  clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
})

afterEach(() => {
  vi.restoreAllMocks()
  landed()
  document.body.innerHTML = ''
})

async function render(options: { open?: boolean; at?: string; rising?: boolean } = {}) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  if (options.at) await router.push(options.at)
  const open = ref(options.open ?? false)
  const closed = vi.fn()
  const push = vi.spyOn(router.options.history, 'push')
  const go = vi.spyOn(router, 'go')

  const host = mount(
    defineComponent(
      () => () =>
        h(
          BottomSheet,
          {
            open: open.value,
            'onUpdate:open': (next: boolean) => (open.value = next),
            onClosed: closed,
          },
          {
            title: () => 'Milk «Ashkhar»',
            meta: () => 'UHT, 2.5%',
            default: () => h('p', { class: 'content' }, 'Quantity and price'),
          },
        ),
    ),
    { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
  )
  const dialog = () => host.get('dialog').element as HTMLDialogElement
  const sheet = () => host.findComponent(BottomSheet)
  // A sheet mounted open has had time to come up, unless a test is about the moment it rises.
  if (options.rising !== true) wait(1000)
  await realTime()
  return { router, host, open, closed, push, go, dialog, sheet }
}

describe('BottomSheet', () => {
  it('stays shut until it is opened', async () => {
    const { dialog, push } = await render()
    expect(dialog().open).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('opens as a modal and lays one entry at the same address', async () => {
    const { open, dialog, push } = await render()
    open.value = true
    await nextTick()
    expect(dialog().open).toBe(true)
    expect(push).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledWith('/', { sheet: true })
  })

  it('opens when it is mounted open', async () => {
    const { dialog, push } = await render({ open: true })
    expect(dialog().open).toBe(true)
    expect(push).toHaveBeenCalledOnce()
  })

  it('is named by its title and has no grab handle', async () => {
    const { host, dialog } = await render({ open: true })
    const title = host.get('h2')
    expect(dialog().getAttribute('aria-labelledby')).toBe(title.attributes('id'))
    expect(title.text()).toBe('Milk «Ashkhar»')
    expect(host.get('.meta').text()).toBe('UHT, 2.5%')
    expect(host.find('.grip, .handle').exists()).toBe(false)
  })

  it('names the close button «Close»', async () => {
    const { host } = await render({ open: true })
    expect(host.get('.head button').attributes('aria-label')).toBe(en.sheet.close)
  })

  it('closes through the history: × steps back, and the step closes it', async () => {
    const { host, open, closed, go, dialog } = await render({ open: true })
    await host.get('.head button').trigger('click')
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(dialog().open).toBe(false)
    expect(open.value).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
  })

  // Esc, and Android's «back» that Chrome hands to a modal dialog: the browser would close it
  // and leave the entry behind.
  it('refuses the browser closing it on cancel and steps back instead', async () => {
    const { go, dialog, closed } = await render({ open: true })
    const cancel = new Event('cancel', { cancelable: true })
    dialog().dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(dialog().open).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
  })

  /** A tap on the scrim: pressed and let go on the dialog itself. */
  async function tapScrim(dialog: HTMLDialogElement): Promise<void> {
    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
  }

  it('closes on a tap on the scrim', async () => {
    const { go, dialog } = await render({ open: true })
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(dialog().open).toBe(false)
  })

  // A text selection that began in a field and overshot is clicked on the dialog — the common
  // ancestor — and would throw away what was typed (adversarial Б-4).
  it('must not fire: a press that began inside the sheet and ended on the scrim', async () => {
    const { host, go, dialog } = await render({ open: true })
    host.get('.content').element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
  })

  // The second tap of a double tap on the opener lands where the scrim now is (adversarial Б-5).
  it('must not fire: a tap on the scrim while the sheet is still coming up', async () => {
    const { go, dialog } = await render({ open: true, rising: true })
    wait(80)
    await tapScrim(dialog())
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
  })

  // …or on the ×, or on the main action sliding under the finger (adversarial Б-5).
  it('must not fire: no tap inside the sheet counts while it is still coming up', async () => {
    const { host, go, dialog } = await render({ open: true, rising: true })
    const tapped = vi.fn()
    host.get('.content').element.addEventListener('click', tapped)
    wait(80)
    await host.get('.head button').trigger('click')
    await host.get('.content').trigger('click')
    expect(go).not.toHaveBeenCalled()
    expect(tapped).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)

    wait(1000)
    await host.get('.content').trigger('click')
    expect(tapped).toHaveBeenCalledOnce()
  })

  it('must not fire: a tap inside the sheet does not close it', async () => {
    const { host, go, dialog } = await render({ open: true })
    await host.get('.content').trigger('click')
    await host.get('.panel').trigger('click')
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
  })

  // The browser's «back», the iOS edge swipe: the entry goes first, then the sheet.
  it('closes when «back» takes its entry away', async () => {
    const { router, open, closed, dialog } = await render({ open: true })
    router.back()
    expect(dialog().open).toBe(false)
    expect(open.value).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
  })

  // «Add to trip» over the search: the sheet and the search go in one step, so the trip's history
  // does not grow by an entry per item.
  it('closes together with the screen under it in one move', async () => {
    const { router, sheet, go, dialog, closed } = await render({ open: true, at: '/trip/add' })
    ;(sheet().vm as unknown as { close: (steps: number) => void }).close(2)
    expect(go).toHaveBeenCalledExactlyOnceWith(-2)
    expect(dialog().open).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })

  it('steps back when the screen shuts it', async () => {
    const { open, go, dialog, closed } = await render({ open: true })
    open.value = false
    await nextTick()
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(dialog().open).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
  })

  // Chrome honours a refused Esc only once per user activation; the second one closes the
  // dialog itself. The entry must still go.
  it('takes its entry away when the browser closed it anyway', async () => {
    const { go, dialog, open, closed } = await render({ open: true })
    dialog().close()
    dialog().dispatchEvent(new Event('close'))
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(open.value).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
  })

  // A second tap on × before the first step lands must not step past the screen, out of the app.
  it('must not fire: a second close while the first is in flight takes no second step', async () => {
    const { router, host, go } = await render({ open: true })
    // Hold the step in flight: the memory history would land it at once.
    vi.spyOn(router.options.history, 'go').mockImplementation(() => undefined)
    await host.get('.head button').trigger('click')
    await host.get('.head button').trigger('click')
    expect(go).toHaveBeenCalledOnce()
  })

  it('opens again after it was closed, with a new entry', async () => {
    const { open, push, host, dialog } = await render({ open: true })
    await host.get('.head button').trigger('click')
    landed()
    open.value = true
    await nextTick()
    expect(dialog().open).toBe(true)
    expect(push).toHaveBeenCalledTimes(2)
  })

  // The pop that took the screen away already took the entry; there is nothing to step off.
  it('must not fire: going away with the screen takes no step of its own', async () => {
    const { host, go } = await render({ open: true })
    host.unmount()
    expect(go).not.toHaveBeenCalled()
  })

  // A screen that opens the next sheet as soon as the last one is put away («add another»):
  // `update:open` false and the new true must not land in one tick, or the prop never changes
  // and the sheet stays shut with the screen believing it open (adversarial А-6).
  it('opens again when the screen reopens it from @closed', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const open = ref(true)
    let again = true
    let reopened = 0
    const host = mount(
      defineComponent(
        () => () =>
          h(
            BottomSheet,
            {
              open: open.value,
              'onUpdate:open': (next: boolean) => (open.value = next),
              onClosed: () => {
                reopened += 1
                if (!again) return
                again = false
                open.value = true
              },
            },
            { title: () => 'Milk' },
          ),
      ),
      { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
    )
    await nextTick()
    const go = vi.spyOn(router, 'go')
    wait(1000)
    await realTime()
    await host.get('.head button').trigger('click')
    landed()
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    const dialog = host.get('dialog').element as HTMLDialogElement
    await vi.waitFor(() => {
      expect({ prop: open.value, dialogOpen: dialog.open, reopened }).toEqual({
        prop: true,
        dialogOpen: true,
        reopened: 1,
      })
    })
  })

  // The `close` event of the last sheet comes a task later; a sheet reopened in between is not
  // the one the browser shut (adversarial А-5).
  it('must not fire: a late close event does not shut the sheet opened again', async () => {
    const { open, go, dialog, host } = await render({ open: true })
    await host.get('.head button').trigger('click')
    landed()
    open.value = true
    await nextTick()
    go.mockClear()
    dialog().dispatchEvent(new Event('close'))
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
  })

  // Left by a push, not a pop: the entry stays in the history, but the screen is told the sheet
  // is shut, so a store holding `open` does not reopen it on the way back (adversarial А-4).
  it('tells the screen it is shut when the screen goes away with it open', async () => {
    const { host, open, go } = await render({ open: true })
    host.unmount()
    expect(open.value).toBe(false)
    expect(go).not.toHaveBeenCalled()
  })

  // «Save and next»: the screen shuts the sheet and asks for it again before the step back has
  // landed. In a browser the pop comes a task later (adversarial Б-6).
  it('opens again when asked while it was closing', async () => {
    const { router, open, dialog, closed } = await render({ open: true })
    const land = router.options.history.go.bind(router.options.history)
    vi.spyOn(router.options.history, 'go').mockImplementation((delta) => {
      setTimeout(() => {
        land(delta)
      }, 0)
    })
    open.value = false
    await nextTick()
    open.value = true
    await nextTick()
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
    await vi.waitFor(() => {
      expect(dialog().open).toBe(true)
    })
    expect(open.value).toBe(true)
  })

  // Past unmounting a component emits nothing, so a deferred `closed` was lost (adversarial Б-7).
  it('says closed when the screen goes away with it open', async () => {
    const { host, closed } = await render({ open: true })
    host.unmount()
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
  })

  // A move of the router while the sheet is open — another screen, or this one with a new query
  // — closes it; the sheet belonged to the place that was left (adversarial Б-3).
  it('closes when the router moves under it, even to the same screen', async () => {
    const { router, open, dialog, closed, go } = await render({ open: true })
    await router.push('/?q=milk')
    expect(dialog().open).toBe(false)
    expect(open.value).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
    expect(go).not.toHaveBeenCalled()
  })

  /** A sheet opened from a sheet — a shop picked over «add to trip». */
  async function twoSheets(at = '/') {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    if (at !== '/') await router.push(at)
    const lower = ref(true)
    const upper = ref(false)
    const host = mount(
      defineComponent(() => () => [
        h(
          BottomSheet,
          {
            open: lower.value,
            'onUpdate:open': (next: boolean) => (lower.value = next),
            class: 'lower',
          },
          { title: () => 'Add to trip' },
        ),
        h(
          BottomSheet,
          {
            open: upper.value,
            'onUpdate:open': (next: boolean) => (upper.value = next),
            class: 'upper',
          },
          { title: () => 'Pick a shop' },
        ),
      ]),
      { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
    )
    await nextTick()
    upper.value = true
    await nextTick()
    wait(1000)
    await realTime()
    const state = () => ({
      lower: (host.get('dialog.lower').element as HTMLDialogElement).open,
      upper: (host.get('dialog.upper').element as HTMLDialogElement).open,
    })
    return { router, host, state }
  }

  // Each sheet took any pop for its own, and one removing itself inside the router's loop made it
  // skip the next: the hidden sheet closed, the visible one stayed (adversarial В-1).
  it('«back» closes only the sheet on top, and the next «back» the one under it', async () => {
    const { router, state } = await twoSheets()
    router.back()
    await nextTick()
    expect(state()).toEqual({ lower: true, upper: false })
    landed()
    router.back()
    await nextTick()
    expect(state()).toEqual({ lower: false, upper: false })
  })

  it('× on the sheet on top closes only that one', async () => {
    const { host, state } = await twoSheets()
    await host.get('dialog.upper .head button').trigger('click')
    await nextTick()
    expect(state()).toEqual({ lower: true, upper: false })
  })

  // A push takes the screen away in the same move that closes the sheet; a deferred `closed` was
  // dropped by Vue for the unmounted component (adversarial В-2).
  it('says closed when a push takes its screen away', async () => {
    const closed = vi.fn()
    const Screen = defineComponent(() => {
      const open = ref(true)
      return () =>
        h(
          BottomSheet,
          {
            open: open.value,
            'onUpdate:open': (next: boolean) => (open.value = next),
            onClosed: closed,
          },
          { title: () => 'Milk' },
        )
    })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Screen },
        { path: '/other', component: { render: () => h('p', 'other') } },
      ],
    })
    await router.push('/')
    mount(RouterView, {
      attachTo: document.body,
      global: { plugins: [router, createAppI18n('en')] },
    })
    await nextTick()
    await router.push('/other')
    await nextTick()
    expect(document.querySelector('dialog')).toBeNull()
    expect(closed).toHaveBeenCalledOnce()
  })

  // A screen that writes `open` after an `await` — a store action, a request before closing.
  // «The prop is still true a tick later» was read as «asked for again», and the sheet the person
  // had just closed came back up over a second entry laid with no tap (adversarial Г-1).
  it.each([
    ['a microtask', (write: () => void) => void Promise.resolve().then(write)],
    ['a request', (write: () => void) => void setTimeout(write, 80)],
  ])('stays shut when the screen writes its false %s late', async (_lag, lag) => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const open = ref(true)
    const closed = vi.fn()
    const push = vi.spyOn(router.options.history, 'push')
    const host = mount(
      defineComponent(
        () => () =>
          h(
            BottomSheet,
            {
              open: open.value,
              'onUpdate:open': (next: boolean) => {
                lag(() => (open.value = next))
              },
              onClosed: closed,
            },
            { title: () => 'Milk' },
          ),
      ),
      { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
    )
    await nextTick()
    wait(1000)
    await realTime()
    const dialog = host.get('dialog').element as HTMLDialogElement
    await host.get('.head button').trigger('click')
    landed()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(open.value).toBe(false)
    expect(dialog.open).toBe(false)
    expect(push).toHaveBeenCalledOnce()
    expect(closed).toHaveBeenCalledOnce()
    host.unmount()
  })

  // A sheet mounted only while it is open — a fresh form for each item. Its `update:open(false)`
  // takes it out of the page before a deferred `closed` could be emitted; a handler held as a prop
  // is still called (adversarial Д-1).
  it.each([
    ['×', 'tap'],
    ['«back»', 'back'],
  ] as const)('says closed after %s when it lives under v-if="open"', async (_way, way) => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const open = ref(true)
    const closed = vi.fn()
    const host = mount(
      defineComponent(
        () => () =>
          open.value
            ? h(
                BottomSheet,
                {
                  open: open.value,
                  'onUpdate:open': (next: boolean) => (open.value = next),
                  onClosed: closed,
                },
                { title: () => 'Milk' },
              )
            : null,
      ),
      { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
    )
    await nextTick()
    wait(1000)
    await realTime()
    if (way === 'tap') await host.get('.head button').trigger('click')
    else router.back()
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
    expect(host.find('dialog').exists()).toBe(false)
    host.unmount()
  })

  // `close(2)` counts the sheet and the screen under it; sheets are entries too, so from a sheet
  // over a sheet it steps over both and leaves the screen (adversarial round 4).
  it('close(2) from a sheet over a sheet leaves the screen', async () => {
    const { router, host, state } = await twoSheets('/trip/add')
    const go = vi.spyOn(router, 'go')
    const upper = host.findAllComponents(BottomSheet)[1]
    ;(upper?.vm as unknown as { close: (steps: number) => void }).close(2)
    expect(go).toHaveBeenCalledExactlyOnceWith(-3)
    expect(state()).toEqual({ lower: false, upper: false })
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/')
    })
  })
})
