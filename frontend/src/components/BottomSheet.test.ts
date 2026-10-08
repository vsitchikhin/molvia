import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, watch } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import BottomSheet from '@/components/BottomSheet.vue'
import StatusStrip from '@/components/StatusStrip.vue'
import { provideAnnouncer, useAnnouncer } from '@/composables/useAnnouncer'
import { pageAnchor } from '@/composables/useSheetHistory'
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

async function render(
  options: {
    open?: boolean
    at?: string
    rising?: boolean
    back?: boolean
    footer?: boolean
    field?: boolean
  } = {},
) {
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
            back: options.back ?? false,
            'onUpdate:open': (next: boolean) => (open.value = next),
            onClosed: closed,
          },
          {
            title: () => 'Milk «Ashkhar»',
            meta: () => 'UHT, 2.5%',
            default: () =>
              options.field === true
                ? [
                    h('p', { class: 'content' }, 'Quantity and price'),
                    h('input', { class: 'price', 'aria-label': 'Price' }),
                  ]
                : h('p', { class: 'content' }, 'Quantity and price'),
            ...(options.footer === true && {
              footer: () => h('button', { class: 'save', type: 'button' }, 'Save'),
            }),
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

  it('over another sheet: «Back» on the left takes this one away, and there is no ×', async () => {
    const { host, open, go, dialog } = await render({ open: true, back: true })
    const buttons = host.findAll('.head button')
    expect(buttons.map((button) => button.attributes('aria-label'))).toEqual([en.nav.back_label])
    expect(dialog().classList.contains('over')).toBe(true)
    await buttons[0]?.trigger('click')
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(open.value).toBe(false)
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
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
  }

  it('closes on a tap on the scrim', async () => {
    const { go, dialog } = await render({ open: true })
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(dialog().open).toBe(false)
  })

  /** The sheet's slide down, held until the test lets it finish. */
  function slide(): { finish: () => Promise<void> } {
    let finish = (): void => undefined
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const animation = { finished } as unknown as Animation
    vi.spyOn(HTMLDialogElement.prototype, 'getAnimations').mockReturnValueOnce([animation])
    return {
      finish: async () => {
        finish()
        await new Promise((resolve) => setTimeout(resolve, 0))
      },
    }
  }

  // Safari has no `overlay`: a dialog closed at once left the top layer at once, and the × and the
  // scrim made the sheet vanish instead of sliding down. The dialog is closed at once — every reader
  // of `dialog[open]` has it shut — and `data-leaving` keeps it drawn until the slide ends.
  it('closes the dialog at once, and keeps it drawn sliding down until the slide ends', async () => {
    const { host, open, closed, go, dialog } = await render({ open: true })
    const sliding = slide()
    await host.get('.head button').trigger('click')
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(open.value).toBe(false)
    await vi.waitFor(() => {
      expect(closed).toHaveBeenCalledOnce()
    })
    expect(dialog().open).toBe(false)
    expect(dialog().hasAttribute('data-leaving')).toBe(true)

    await sliding.finish()
    expect(dialog().hasAttribute('data-leaving')).toBe(false)
  })

  it('must not fire: with no slide to play, nothing is left drawn', async () => {
    const { host, dialog } = await render({ open: true })
    await host.get('.head button').trigger('click')
    expect(dialog().open).toBe(false)
    expect(dialog().hasAttribute('data-leaving')).toBe(false)
  })

  it('must not fire: a tap on the scrim while the sheet slides down takes no second step', async () => {
    const { go, dialog } = await render({ open: true })
    const sliding = slide()
    await tapScrim(dialog())
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    await sliding.finish()
    expect(go).toHaveBeenCalledOnce()
  })

  // «Save and next» while the last showing still slides down: it comes back up, and the end of the
  // slide cut short takes nothing off the sheet shown again.
  it('opened again while it slides down, it comes back up and stays up', async () => {
    const { host, open, push, dialog } = await render({ open: true })
    const sliding = slide()
    await host.get('.head button').trigger('click')
    landed()
    open.value = true
    await nextTick()
    expect(dialog().open).toBe(true)
    expect(dialog().hasAttribute('data-leaving')).toBe(false)
    expect(push).toHaveBeenCalledTimes(2)

    await sliding.finish()
    expect(dialog().open).toBe(true)
    expect(dialog().hasAttribute('data-leaving')).toBe(false)
  })

  // A text selection that began in a field and overshot is clicked on the dialog — the common
  // ancestor — and would throw away what was typed (adversarial Б-4).
  // iOS hands a touch to the page only where a listener stands, and the scrim lies outside the
  // dialog's box: a listener on the dialog never heard a tap there, and on an iPhone the sheet did
  // not close (MOL-80). Measured on the owner's phone; happy-dom has no such layer, so what is held
  // here is where the listener stands.
  it('hears a press on the document while it is open, and lets go of it once it is shut', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { host } = await render({ open: true })
    const heard = add.mock.calls.find(([type]) => type === 'pointerdown')
    expect(heard?.[2]).toEqual({ capture: true, passive: true })
    await host.get('.head button').trigger('click')
    await nextTick()
    expect(remove).toHaveBeenCalledWith('pointerdown', heard?.[1], { capture: true, passive: true })
    expect(remove).toHaveBeenCalledWith('pointercancel', expect.any(Function), {
      capture: true,
      passive: true,
    })
  })

  it('must not fire: a shut sheet does not listen on the document', async () => {
    const add = vi.spyOn(document, 'addEventListener')
    await render()
    expect(add.mock.calls.some(([type]) => type === 'pointerdown')).toBe(false)
  })

  it('closes on a tap on the scrim that only the document heard pressed', async () => {
    const { dialog, go } = await render({ open: true })
    const press = new PointerEvent('pointerdown', { bubbles: true })
    Object.defineProperty(press, 'target', { value: dialog() })
    document.dispatchEvent(press)
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

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

  /** The sheet's own rise, held until the test lets it finish or cuts it short. */
  function rise(): { finish: () => Promise<void>; cut: () => Promise<void> } {
    let finish = (): void => undefined
    let cut = (): void => undefined
    const finished = new Promise<void>((resolve, reject) => {
      finish = resolve
      cut = () => {
        reject(new DOMException('The rise was cut short', 'AbortError'))
      }
    })
    const animation = { finished } as unknown as Animation
    vi.spyOn(HTMLDialogElement.prototype, 'getAnimations').mockReturnValueOnce([animation])
    const settles = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return {
      finish: async () => {
        finish()
        await settles()
      },
      cut: async () => {
        cut()
        await settles()
      },
    }
  }

  // Up is the end of the rise, not a clock: under load the first frame came late, the rise
  // outlasted a double tap and the second tap closed the sheet while it slid (MOL-69).
  it('must not fire: a tap on the scrim while the rise outlasts a double tap', async () => {
    const rising = rise()
    const { go, dialog } = await render({ open: true, rising: true })
    wait(400)
    await tapScrim(dialog())
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)

    await rising.finish()
    wait(10)
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // Boundary: a rise shorter than a double tap still holds the double tap.
  it('must not fire: a tap within a double tap after a quick rise', async () => {
    const rising = rise()
    const { go, dialog } = await render({ open: true, rising: true })
    wait(100)
    await rising.finish()
    wait(150)
    await tapScrim(dialog())
    expect(go).not.toHaveBeenCalled()

    wait(50)
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // A rise cut short settles the sheet too, or it would take no tap ever again.
  it('takes a tap after a rise that was cut short', async () => {
    const rising = rise()
    const { go, dialog } = await render({ open: true, rising: true })
    await rising.cut()
    wait(300)
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // A click is born when the finger lifts: one put down on the scrim while the sheet rose and
  // lifted once it was up counts from the touch, not the lift (MOL-69, adversarial А1). So does
  // a tap a busy main thread hands over late.
  it('must not fire: a finger put down on the scrim while it rose and lifted once it was up', async () => {
    const rising = rise()
    const { go, dialog } = await render({ open: true, rising: true })
    wait(100)
    dialog().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    wait(400)
    await rising.finish()
    wait(100)
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
  })

  // …or on the main action, which slid under it meanwhile (adversarial А2).
  it('must not fire: the main action under a finger put down while it rose', async () => {
    const rising = rise()
    const { host, dialog } = await render({ open: true, rising: true })
    const tapped = vi.fn()
    const content = host.get('.content').element
    content.addEventListener('click', tapped)
    wait(100)
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    wait(400)
    await rising.finish()
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(tapped).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)

    // The next finger, put down once it is up, is taken.
    wait(10)
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(tapped).toHaveBeenCalledOnce()
  })

  // A click from the keyboard has no finger: a touch left over from the rise does not date it.
  it('takes a click from the keyboard once up, whatever finger touched while it rose', async () => {
    const rising = rise()
    const { host } = await render({ open: true, rising: true })
    const tapped = vi.fn()
    const content = host.get('.content').element
    content.addEventListener('click', tapped)
    wait(100)
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    wait(400)
    await rising.finish()
    wait(10)
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(tapped).toHaveBeenCalledOnce()
  })

  // A click with no finger in between — a hardware key, switch access — did spend the touch of
  // the finger still resting, and that finger was then judged by its lift (adversarial Б1).
  it('must not fire: a click from the keyboard between a touch and its lift', async () => {
    const rising = rise()
    const { host } = await render({ open: true, rising: true })
    const tapped = vi.fn()
    const content = host.get('.content').element
    content.addEventListener('click', tapped)
    wait(100)
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    wait(400)
    await rising.finish()
    wait(10)
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    expect(tapped).toHaveBeenCalledOnce()
    wait(100)
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(tapped).toHaveBeenCalledOnce()
  })

  // A label and the radio it clicks for it are one touch, judged by it alike (adversarial З1).
  it('must not fire: the second click of one touch made while it rose', async () => {
    const rising = rise()
    const { host } = await render({ open: true, rising: true })
    const tapped = vi.fn()
    const content = host.get('.content').element
    content.addEventListener('click', tapped)
    wait(100)
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    wait(400)
    await rising.finish()
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(tapped).not.toHaveBeenCalled()
  })

  // A touch the platform took back makes no click, and dates none after it (review Р-3).
  it('takes a click with no touch of its own after a touch that was taken back', async () => {
    const rising = rise()
    const { host } = await render({ open: true, rising: true })
    const tapped = vi.fn()
    const content = host.get('.content').element
    content.addEventListener('click', tapped)
    wait(100)
    content.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    content.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
    wait(400)
    await rising.finish()
    wait(10)
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(tapped).toHaveBeenCalledOnce()
  })

  // Nor does a touch of the sheet's last showing (review Р-3).
  it('takes a click with no touch of its own after a touch of the last showing', async () => {
    const first = rise()
    const { host, open, dialog } = await render({ open: true, rising: true })
    wait(100)
    dialog().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await first.finish()
    open.value = false
    await nextTick()
    landed()
    const second = rise()
    open.value = true
    await nextTick()
    wait(400)
    await second.finish()
    wait(10)
    const tapped = vi.fn()
    host.get('.content').element.addEventListener('click', tapped)
    host
      .get('.content')
      .element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    expect(tapped).toHaveBeenCalledOnce()
  })

  // «Save and next»: the rise of the sheet that was put away must not settle the next one.
  it('must not fire: the rise of a closed sheet does not settle the one opened after it', async () => {
    const first = rise()
    const { open, go, dialog } = await render({ open: true, rising: true })
    open.value = false
    await nextTick()
    landed()
    const second = rise()
    open.value = true
    await nextTick()
    await first.finish()
    wait(1000)
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledOnce()
    expect(dialog().open).toBe(true)

    await second.finish()
    await tapScrim(dialog())
    expect(go).toHaveBeenCalledTimes(2)
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

// The main action stays at the sheet's bottom edge, and the content scrolls under it (MOL-182). The
// pinning itself is layout, held end to end; here, what the layout is built from.
describe('the pinned footer', () => {
  /** A `ResizeObserver` the test fires by hand: happy-dom lays nothing out and observes nothing. */
  function observeByHand() {
    const callbacks = new Set<() => void>()
    vi.stubGlobal(
      'ResizeObserver',
      class {
        callback: () => void
        constructor(callback: () => void) {
          this.callback = callback
        }
        observe() {
          callbacks.add(this.callback)
        }
        disconnect() {
          callbacks.delete(this.callback)
        }
      },
    )
    return () => {
      for (const callback of callbacks) callback()
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stands outside the content, the dialog’s own, after it', async () => {
    const { dialog } = await render({ open: true, footer: true })
    const footer = dialog().querySelector('.footer')
    expect(footer?.parentElement).toBe(dialog())
    expect(footer?.previousElementSibling?.classList.contains('panel')).toBe(true)
    expect(footer?.textContent).toBe('Save')
    expect(dialog().querySelector('.panel')?.classList.contains('footed')).toBe(true)
  })

  it('must not fire: no footer is drawn without one given', async () => {
    const { dialog } = await render({ open: true })
    expect(dialog().querySelector('.footer')).toBeNull()
    expect(dialog().querySelector('.panel')?.classList.contains('footed')).toBe(false)
    expect(dialog().classList.contains('pinned')).toBe(false)
    expect(dialog().style.getPropertyValue('--sheet-footer-height')).toBe('0px')
  })

  // What the sheet scrolls into sight stops at the footer's top: its `scroll-padding` is the
  // footer's height, kept as the footer grows — an error or «Вернуть» come into it.
  it('gives the dialog its height, and follows it', async () => {
    const resized = observeByHand()
    const { dialog } = await render({ footer: true })
    const footer = dialog().querySelector<HTMLElement>('.footer')
    if (!footer) throw new Error('no footer in the sheet')
    let height = 76
    Object.defineProperty(footer, 'offsetHeight', { get: () => height })
    resized()
    await nextTick()
    expect(dialog().style.getPropertyValue('--sheet-footer-height')).toBe('76px')
    height = 120
    resized()
    await nextTick()
    expect(dialog().style.getPropertyValue('--sheet-footer-height')).toBe('120px')
  })

  /**
   * The sheet laid out by hand: its box, how far it scrolls, the footer's height and the field's.
   * `layout` changes them and tells the observers, as a resize would.
   */
  async function laidOut(box: { sheet: number; scrolls: number; footer: number; field: number }) {
    const resized = observeByHand()
    const { dialog } = await render({ open: true, footer: true, field: true })
    const footer = dialog().querySelector<HTMLElement>('.footer')
    const field = dialog().querySelector<HTMLElement>('.price')
    if (!footer || !field) throw new Error('no footer or no field in the sheet')
    Object.defineProperty(dialog(), 'clientHeight', { get: () => box.sheet })
    Object.defineProperty(dialog(), 'offsetHeight', { get: () => box.sheet })
    Object.defineProperty(dialog(), 'scrollHeight', { get: () => box.scrolls })
    Object.defineProperty(footer, 'offsetHeight', { get: () => box.footer })
    field.getBoundingClientRect = () => DOMRect.fromRect({ width: 300, height: box.field })
    const layout = async (next: Partial<typeof box>) => {
      Object.assign(box, next)
      resized()
      await nextTick()
    }
    return { dialog, field, layout }
  }

  // Over the keys of a turned phone the sheet has some 107 px: a footer of 77 pinned there left 29 px
  // of the 44 the price is typed in (adversarial А1). It goes with the content then; held upright, it
  // is pinned again.
  it('is let go when it leaves no room for the field typed in, and pinned again when it does', async () => {
    const { dialog, field, layout } = await laidOut({
      sheet: 334,
      scrolls: 600,
      footer: 77,
      field: 44,
    })
    field.focus()
    await layout({})
    expect(dialog().classList.contains('pinned')).toBe(true)
    await layout({ sheet: 107 })
    expect(dialog().classList.contains('pinned')).toBe(false)
    await layout({ sheet: 121 })
    expect(dialog().classList.contains('pinned')).toBe(true)
  })

  it('must not fire: no field typed in, however little room it leaves', async () => {
    const { dialog, layout } = await laidOut({ sheet: 107, scrolls: 600, footer: 121, field: 54 })
    await layout({})
    expect(dialog().classList.contains('pinned')).toBe(true)
  })

  it('is pinned again when the field typed in is left', async () => {
    const { dialog, field, layout } = await laidOut({
      sheet: 107,
      scrolls: 600,
      footer: 77,
      field: 44,
    })
    field.focus()
    await layout({})
    expect(dialog().classList.contains('pinned')).toBe(false)
    field.blur()
    await nextTick()
    expect(dialog().classList.contains('pinned')).toBe(true)
  })

  // The edit of an account over the keys held upright: a footer more than half the sheet, room enough
  // for the name. Half the sheet let it go, «Сохранить» with it (round 2, Р2-А1).
  it('must not fire: a footer more than half the sheet that leaves room for the field', async () => {
    const { dialog, field, layout } = await laidOut({
      sheet: 324,
      scrolls: 600,
      footer: 167,
      field: 54,
    })
    field.focus()
    await layout({})
    expect(dialog().classList.contains('pinned')).toBe(true)
    // An error come into the footer under the finger (Р2-А2): still room for the field.
    await layout({ sheet: 281, footer: 168, field: 44 })
    expect(dialog().classList.contains('pinned')).toBe(true)
  })

  // A sheet that does not scroll hides nothing under its footer, which keeps its shadow (С-11).
  it('must not fire: a sheet that does not scroll', async () => {
    const { dialog, field, layout } = await laidOut({
      sheet: 107,
      scrolls: 107,
      footer: 77,
      field: 44,
    })
    field.focus()
    await layout({})
    expect(dialog().classList.contains('pinned')).toBe(true)
  })

  // The keys take the home indicator's 34 off the footer's bottom padding, and the stylesheet adds
  // that padding to the edge itself, in the same style change: measured whole, the edge lagged a
  // render behind and a field stood 34 over the footer (review С-8).
  it('gives its height less its bottom padding, which the keys change and it does not', async () => {
    const resized = observeByHand()
    const { dialog } = await render({ footer: true })
    const footer = dialog().querySelector<HTMLElement>('.footer')
    if (!footer) throw new Error('no footer in the sheet')
    let height = 110
    Object.defineProperty(footer, 'offsetHeight', { get: () => height })
    footer.style.paddingBottom = '46px'
    resized()
    await nextTick()
    expect(dialog().style.getPropertyValue('--sheet-footer-height')).toBe('64px')
    height = 76
    footer.style.paddingBottom = '12px'
    resized()
    await nextTick()
    expect(dialog().style.getPropertyValue('--sheet-footer-height')).toBe('64px')
  })
})

/**
 * The page under a sheet, put back where it stood (MOL-63, adversarial В2–В4). happy-dom lays
 * nothing out, so where the opener stands on the screen, and the window's scroll, are the test's to
 * say.
 */
describe('the page under the sheet', () => {
  function scrolledTo(top: number): void {
    Object.defineProperty(window, 'scrollY', { value: top, configurable: true })
  }

  afterEach(() => {
    scrolledTo(0)
  })

  function opener(top: { value: number }): HTMLButtonElement {
    const button = document.createElement('button')
    document.body.append(button)
    vi.spyOn(button, 'getBoundingClientRect').mockImplementation(
      () => ({ top: top.value }) as DOMRect,
    )
    return button
  }

  /** The screen opens the sheet from the button's click, as a screen does. */
  async function sheetOn(button: HTMLElement, options: { at?: string } = {}) {
    const rendered = await render(options)
    button.addEventListener('click', () => {
      rendered.open.value = true
    })
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    return { ...rendered, scrollBy, scrollTo }
  }

  async function openFrom(button: HTMLElement, options: { at?: string } = {}) {
    const rendered = await sheetOn(button, options)
    button.click()
    await nextTick()
    return rendered
  }

  // The iOS keyboard for a field in the sheet may move the window; nothing else moves it back.
  it('is put back when the window moved under the sheet', async () => {
    scrolledTo(900)
    const top = { value: 400 }
    const { router, scrollBy } = await openFrom(opener(top))
    top.value = 1000
    router.back()
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 600, behavior: 'auto' })
  })

  // iOS does not focus a tapped button: what was activated says what opened the sheet.
  it('is measured by what was activated, whatever holds the focus', async () => {
    scrolledTo(900)
    const top = { value: 400 }
    const button = opener(top)
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    const { router, scrollBy } = await openFrom(button)
    top.value = 100
    router.back()
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: -300, behavior: 'auto' })
  })

  // Enter on a focused button is a click with no press; a press elsewhere before it measured the
  // sheet by the wrong element and brought the jump of MOL-63 back (review С-4, adversarial В3).
  it('is measured by the button activated from the keyboard, not by an older press', async () => {
    scrolledTo(900)
    const elsewhere = { value: 50 }
    const other = opener(elsewhere)
    other.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    other.click()
    await realTime()
    const top = { value: 400 }
    const button = opener(top)
    button.focus()
    const { router, scrollBy } = await openFrom(button)
    elsewhere.value = -70
    router.back()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  // A sheet opened later, with no click of its own — after an answer from the API — is measured by
  // the focus, never by what was clicked before (review С-4).
  it('forgets a click once its task is over', async () => {
    scrolledTo(900)
    const elsewhere = { value: 50 }
    const other = opener(elsewhere)
    const { router, open, scrollBy } = await sheetOn(document.createElement('span'))
    other.click()
    await realTime()
    const top = { value: 400 }
    const button = opener(top)
    button.focus()
    open.value = true
    await nextTick()
    elsewhere.value = -70
    top.value = 700
    router.back()
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 300, behavior: 'auto' })
  })

  // The list changed height above it and the browser kept the opener still: nothing to put back.
  it('must not fire: the opener stands where it stood', async () => {
    scrolledTo(900)
    const { router, scrollBy } = await openFrom(opener({ value: 400 }))
    router.back()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('must not fire: the opener is gone — the row the sheet deleted', async () => {
    scrolledTo(900)
    const top = { value: 400 }
    const button = opener(top)
    const { router, scrollBy } = await openFrom(button)
    button.remove()
    top.value = 1000
    router.back()
    expect(scrollBy).not.toHaveBeenCalled()
  })

  // The screen goes with the sheet, and the router puts the one under it where it was.
  it('must not fire: close(2) leaves the screen', async () => {
    scrolledTo(900)
    const top = { value: 400 }
    const { sheet, scrollBy } = await openFrom(opener(top), { at: '/trip/add' })
    top.value = 1000
    ;(sheet().vm as unknown as { close: (steps: number) => void }).close(2)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  // At the very top the browser keeps nothing still: a notice arrived above the list pushes it
  // down and stays in sight. Measured by the opener, it was scrolled under the bar (adversarial В4).
  it('must not fire: at the top of the page, what arrived above the list stays in sight', async () => {
    const top = { value: 400 }
    const { router, scrollBy, scrollTo } = await openFrom(opener(top))
    top.value = 520
    router.back()
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('takes the page back to the top when the window moved off it under the sheet', async () => {
    const { router, scrollTo } = await openFrom(opener({ value: 400 }))
    scrolledTo(300)
    router.back()
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'auto' })
  })

  // A sheet over a sheet is opened from inside a dialog, which the page's scroll does not move.
  it('takes no measure from inside a dialog', () => {
    const dialog = document.createElement('dialog')
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(dialog)
    button.click()
    expect(pageAnchor()).toBeNull()
  })
})

describe('focus after the sheet', () => {
  /** A button with an icon in it, as the screens have: a tap lands on the icon. */
  function opener(): { button: HTMLButtonElement; icon: HTMLSpanElement } {
    const button = document.createElement('button')
    const icon = document.createElement('span')
    button.append(icon)
    document.body.append(button)
    return { button, icon }
  }

  async function openFrom(target: HTMLElement, options: { at?: string } = {}) {
    const rendered = await render(options)
    target.addEventListener('click', () => {
      rendered.open.value = true
    })
    target.click()
    await nextTick()
    return rendered
  }

  /** Where Safari leaves it: a tapped button never had focus, so the dialog gives it to nothing. */
  function leftNowhere(): void {
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  // Safari does not focus a tapped button, so the dialog had nothing to give focus back to, and a
  // screen reader was left at the top of the page (MOL-80).
  it('goes back to the button it was opened from when the platform left it nowhere', async () => {
    const { button, icon } = opener()
    const { router, dialog } = await openFrom(icon)
    leftNowhere()
    router.back()
    expect(dialog().open).toBe(false)
    expect(document.activeElement).toBe(button)
  })

  // WebKit still names the closed dialog as focused — a tap on no control in it focused the dialog.
  it('goes back to the button when focus is still inside the closed dialog', async () => {
    const { button } = opener()
    const { router, host } = await openFrom(button)
    ;(host.get('.head button').element as HTMLButtonElement).focus()
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open')
    })
    router.back()
    close.mockRestore()
    expect(document.activeElement).toBe(button)
  })

  // Over a sheet in Safari the platform gives focus back to what the sheet under it held — its
  // field — not to the row that opened the picker, which the tap never focused (review Р-3).
  it('goes back to the button when the platform gave focus back to what held it at the opening', async () => {
    const { button } = opener()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    const { router } = await openFrom(button)
    field.focus()
    router.back()
    expect(document.activeElement).toBe(button)
  })

  // Chromium and a keyboard give focus back themselves; the sheet does not take it from there.
  it('must not fire: focus the platform gave back somewhere stays there', async () => {
    const { button } = opener()
    const field = document.createElement('input')
    document.body.append(field)
    const { router } = await openFrom(button)
    field.focus()
    router.back()
    expect(document.activeElement).toBe(field)
  })

  it('must not fire: the button is gone — the row the sheet deleted', async () => {
    const { button } = opener()
    const { router } = await openFrom(button)
    button.remove()
    leftNowhere()
    router.back()
    expect(document.activeElement).toBe(document.body)
  })

  it('must not fire: a button under `inert` is not given focus', async () => {
    const { button } = opener()
    const { router } = await openFrom(button)
    button.setAttribute('inert', '')
    leftNowhere()
    router.back()
    expect(document.activeElement).not.toBe(button)
  })

  // The screen goes with the sheet, and what the next screen focuses is the router's business.
  it('must not fire: close(2) leaves the screen', async () => {
    const { button } = opener()
    const { sheet } = await openFrom(button, { at: '/trip/add' })
    leftNowhere()
    ;(sheet().vm as unknown as { close: (steps: number) => void }).close(2)
    expect(document.activeElement).not.toBe(button)
  })
})

describe('pulled down', () => {
  const HEIGHT = 400

  async function pulled(options: { rising?: boolean } = {}) {
    const rendered = await render({ open: true, ...options })
    const dialog = rendered.dialog()
    Object.defineProperty(dialog, 'offsetHeight', { value: HEIGHT, configurable: true })
    return rendered
  }

  function point(target: Element, x: number, y: number): Touch {
    return new Touch({ identifier: 0, target, clientX: x, clientY: y })
  }

  /** One finger on `target`, down at `y`; `to` moves it `after` ms later. */
  function finger(target: Element, y: number, x = 100) {
    const events: TouchEvent[] = []
    const send = (type: string, touches: Touch[], changed: Touch[]) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches,
        changedTouches: changed,
      })
      events.push(event)
      target.dispatchEvent(event)
      return event
    }
    let last = point(target, x, y)
    send('touchstart', [last], [last])
    return {
      events,
      to(nextY: number, nextX = x, after = 16) {
        wait(after)
        last = point(target, nextX, nextY)
        return send('touchmove', [last], [last])
      },
      /** A second finger comes down as a browser tells it: its own `touchstart` comes first. */
      second() {
        let other = new Touch({ identifier: 1, target, clientX: x + 100, clientY: last.clientY })
        send('touchstart', [last, other], [other])
        return {
          to(nextY: number) {
            wait(16)
            last = point(target, last.clientX, nextY)
            other = new Touch({ identifier: 1, target, clientX: x + 100, clientY: nextY })
            return send('touchmove', [last, other], [last, other])
          },
          up() {
            send('touchend', [last], [other])
          },
        }
      },
      /** Lifts the finger — `after` ms later and at `atY`, if it went on since the last move. */
      up(atY = last.clientY, after = 0) {
        wait(after)
        last = point(target, last.clientX, atY)
        send('touchend', [], [last])
      },
      cancel() {
        send('touchcancel', [], [last])
      },
    }
  }

  async function frame(): Promise<void> {
    await new Promise((resolve) => requestAnimationFrame(resolve))
  }

  // A shut sheet stays on many screens, and the shell holds no touch listener anywhere (MOL-17,
  // e2e `navigation.spec.ts`). Counted from after the mount: the test wrapper listens to every
  // native event of the component's root to record what it emits.
  it('listens for touches only while it is open', async () => {
    const { open, host, dialog } = await render()
    const add = vi.spyOn(dialog(), 'addEventListener')
    const remove = vi.spyOn(dialog(), 'removeEventListener')
    const touches = (spy: typeof add) =>
      spy.mock.calls
        .filter(([type]) => type.startsWith('touch'))
        .map(([type, listener]) => [type, listener])
    open.value = true
    await nextTick()
    const added = touches(add)
    expect(added.map(([type]) => type)).toEqual([
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
    ])
    expect(add.mock.calls.find(([type]) => type === 'touchmove')?.[2]).toEqual({ passive: false })
    wait(1000)
    await realTime()
    await host.get('.head button').trigger('click')
    await nextTick()
    expect(touches(remove)).toEqual(added)
  })

  it('follows the finger, and the scrim fades with it', async () => {
    const { dialog, host } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    const move = drag.to(210)
    expect(move.defaultPrevented).toBe(true)
    expect(dialog().style.transform).toBe('translateY(100px)')
    expect(dialog().style.getPropertyValue('--sheet-drag')).toBe(String(100 / HEIGHT))
    expect(dialog().classList.contains('dragging')).toBe(false)
    await nextTick()
    expect(dialog().classList.contains('dragging')).toBe(true)
  })

  // A quarter is the owner's line (В-4); slow, so no flick decides it.
  it('closes through the history once let go past a quarter of its height', async () => {
    const { host, go, open } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(110 + HEIGHT / 4 + 1, 100, 500)
    drag.up()
    await frame()
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    expect(open.value).toBe(false)
  })

  it('must not fire: let go exactly at a quarter, slowly — it goes back up', async () => {
    const { host, go, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(110 + HEIGHT / 4, 100, 500)
    drag.up()
    await frame()
    expect(go).not.toHaveBeenCalled()
    expect(dialog().open).toBe(true)
    expect(dialog().style.transform).toBe('')
    expect(dialog().style.getPropertyValue('--sheet-drag')).toBe('')
  })

  it('closes on a flick short of the quarter', async () => {
    const { host, go } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(150, 100, 20)
    drag.up()
    await frame()
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  it('must not fire: a short slow pull goes back up', async () => {
    const { host, go, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(150, 100, 400)
    drag.up()
    await frame()
    expect(go).not.toHaveBeenCalled()
    expect(dialog().style.transform).toBe('')
  })

  it('must not fire: a finger that moves less than a tap does', async () => {
    const { host, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    const move = drag.to(103)
    drag.up()
    expect(move.defaultPrevented).toBe(false)
    expect(dialog().style.transform).toBe('')
  })

  it('must not fire: content scrolled down scrolls back first', async () => {
    const { host, dialog, go } = await pulled()
    dialog().scrollTop = 60
    const drag = finger(host.get('.content').element, 100)
    const move = drag.to(200)
    drag.up()
    await frame()
    expect(move.defaultPrevented).toBe(false)
    expect(dialog().style.transform).toBe('')
    expect(go).not.toHaveBeenCalled()
  })

  // A finger in a field moves the caret and selects (owner's decision В-6).
  it('must not fire: a pull that starts in a field', async () => {
    const { dialog, go } = await pulled()
    const field = document.createElement('input')
    dialog().append(field)
    const drag = finger(field, 100)
    drag.to(110)
    const move = drag.to(300)
    drag.up()
    await frame()
    expect(move.defaultPrevented).toBe(false)
    expect(go).not.toHaveBeenCalled()
  })

  it('must not fire: a finger that goes sideways first, then down', async () => {
    const { host, go } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(104, 120)
    drag.to(300, 120)
    drag.up()
    await frame()
    expect(go).not.toHaveBeenCalled()
  })

  it('must not fire: a finger that goes up — a scroll', async () => {
    const { host, go, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 300)
    const move = drag.to(250)
    drag.to(400)
    drag.up()
    await frame()
    expect(move.defaultPrevented).toBe(false)
    expect(dialog().style.transform).toBe('')
    expect(go).not.toHaveBeenCalled()
  })

  // The opener's second tap lands on the sheet while it rises (MOL-69); nor may a finger pull it.
  it('must not fire: a finger that came down while it was still coming up', async () => {
    const { host, go, dialog } = await pulled({ rising: true })
    const drag = finger(host.get('.content').element, 100)
    wait(1000)
    drag.to(110)
    drag.to(300)
    drag.up()
    await frame()
    expect(dialog().style.transform).toBe('')
    expect(go).not.toHaveBeenCalled()
  })

  // The browser sends the second finger's `touchstart` before any move of two: the pull froze where
  // it was, and lifting either finger closed the sheet with its sum typed (adversarial Б).
  it('must not fire: a second finger puts it back, and neither lift closes it', async () => {
    const { host, go, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(300, 100, 200)
    expect(dialog().style.transform).toBe('translateY(190px)')
    const second = drag.second()
    await frame()
    expect(dialog().style.transform).toBe('')
    const move = second.to(400)
    expect(move.defaultPrevented).toBe(false)
    expect(dialog().style.transform).toBe('')
    second.up()
    drag.to(420)
    drag.up()
    await frame()
    expect(go).not.toHaveBeenCalled()
    expect(dialog().style.transform).toBe('')
  })

  // A finger at rest sends no move: a fast pull held still and then let go — changed its mind — was
  // read at the speed of the pull and closed the sheet (adversarial А, review Р-1).
  it('must not fire: a fast short pull held still, then let go — it goes back up', async () => {
    const { host, go, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    for (const y of [110, 130, 150, 170]) drag.to(y)
    wait(1000)
    drag.up()
    await frame()
    expect(go).not.toHaveBeenCalled()
    expect(dialog().style.transform).toBe('')
  })

  // A flick is measured over the moments before the lift: at the window's edge it still counts.
  it('closes on a fast short pull let go within the flick window', async () => {
    const { host, go } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    for (const y of [110, 130, 150, 170, 190, 210, 230, 250]) drag.to(y)
    wait(40)
    drag.up()
    await frame()
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // A lift comes between two frames, and the finger went on meanwhile: that way counts with that
  // time, or a flick just over the line read as under it (adversarial Г).
  it('closes on a short flick let go between two moves, where the finger went on', async () => {
    const { host, go } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    // 0.5 px/ms, a frame a report: to the last report 16 px in 40 ms — the line itself; to the lift,
    // 20 px.
    drag.to(110)
    drag.to(118)
    drag.to(126)
    drag.up(130, 8)
    await frame()
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  // A sheet inside this one — in its slot — pulls itself; the touch that bubbles up is not ours,
  // or both would step back and the one under it would go with its sum typed (review Р-2).
  it('must not fire: a pull on a sheet inside it', async () => {
    const { dialog, go } = await pulled()
    const inner = document.createElement('dialog')
    const row = document.createElement('p')
    inner.append(row)
    dialog().append(inner)
    const drag = finger(row, 100)
    drag.to(110)
    const move = drag.to(300)
    drag.up()
    await frame()
    expect(move.defaultPrevented).toBe(false)
    expect(dialog().style.transform).toBe('')
    expect(go).not.toHaveBeenCalled()
  })

  it('must not fire: a touch the platform took back puts it back', async () => {
    const { host, go, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(300)
    drag.cancel()
    await frame()
    expect(go).not.toHaveBeenCalled()
    expect(dialog().style.transform).toBe('')
  })

  // Opened again after it was pulled away, it comes up as the stylesheet draws it.
  it('opens again without the offset it was pulled away with', async () => {
    const { host, open, dialog } = await pulled()
    const drag = finger(host.get('.content').element, 100)
    drag.to(110)
    drag.to(300)
    drag.up()
    await frame()
    landed()
    await nextTick()
    open.value = true
    await nextTick()
    expect(dialog().open).toBe(true)
    expect(dialog().style.transform).toBe('')
    expect(dialog().style.getPropertyValue('--sheet-drag')).toBe('')
  })
})

// The app's live region is outside the modal dialog, inert while the sheet is open: words said
// there by a block inside the sheet were never read (MOL-181, feedback С-10).
describe('words said inside the sheet', () => {
  const OFFLINE = 'Без связи · остаток на 14:05'

  // Long enough for words asked now to land (the region's delay is 100 ms).
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

  /**
   * A screen as screens hold a sheet — mounted always and led by `open` — with the app's region
   * beside it. `strip` puts the strip in the sheet; `restored` makes a block in the sheet say an
   * event once, as «Восстановлено» is said; `screen` makes the screen beside the sheet say words.
   */
  async function renderSpeaking(options: { open?: boolean; strip?: boolean } = {}) {
    const router: Router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const open = ref(options.open ?? false)
    const strip = ref(options.strip ?? false)
    const restored = ref(false)
    const screen = ref<string | null>(null)
    const Restored = defineComponent({
      setup() {
        useAnnouncer()?.('Восстановлено')
        return () => h('p', 'Восстановлено')
      },
    })
    const Screen = defineComponent({
      setup() {
        const announce = useAnnouncer()
        watch(screen, (words) => {
          if (words) announce?.(words)
        })
        return () => null
      },
    })
    const host = mount(
      defineComponent({
        setup() {
          const app = provideAnnouncer()
          return () => [
            h(
              'div',
              { class: 'app-region' },
              app.value.map((a) => h('p', { key: a.id }, a.text)),
            ),
            h(Screen),
            h(
              BottomSheet,
              { open: open.value, 'onUpdate:open': (next: boolean) => (open.value = next) },
              {
                title: () => 'Сверка',
                default: () => [
                  strip.value
                    ? h(StatusStrip, { kind: 'offline', text: OFFLINE })
                    : h('p', 'Остаток'),
                  restored.value ? h(Restored) : null,
                ],
              },
            ),
          ]
        },
      }),
      { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
    )
    wait(1000)
    await realTime()

    // Every node added to the sheet's region, with whether the dialog was open as it came.
    const dialog = host.get('dialog').element as HTMLDialogElement
    const region = host.get('dialog .region')
    const added: { text: string; open: boolean }[] = []
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes)
          added.push({ text: node.textContent?.trim() ?? '', open: dialog.open })
    }).observe(region.element, { childList: true })

    async function toggle(up: boolean): Promise<void> {
      open.value = up
      await nextTick()
      if (!up) landed()
      wait(1000)
      await realTime()
    }
    return { host, region, dialog, added, strip, restored, screen, toggle }
  }

  it('has a region of its own, a status, empty until something speaks', async () => {
    const { region } = await renderSpeaking({ open: true })
    expect(region.attributes('role')).toBe('status')
    expect(region.text()).toBe('')
  })

  it('says a block’s words in its own region, not in the app’s, with no role beside it', async () => {
    const { host, region, strip } = await renderSpeaking({ open: true })
    strip.value = true
    await vi.waitFor(() => {
      expect(region.text()).toBe(OFFLINE)
    })
    expect(host.get('.app-region').text()).toBe('')
    expect(host.get('.strip').attributes('role')).toBeUndefined()
  })

  // A sheet is mounted closed with its screen: the strip came long before «Сверить». Said into a
  // shut dialog its words reached no one, and the opening said nothing (review С-6, adversarial А1,
  // А2). Now they wait, and are said a task after the opening — never a region shown holding words.
  it('says what a block holds a task after it opens, not into the shut dialog', async () => {
    const { host, region, added, toggle } = await renderSpeaking({ strip: true })
    await settle()
    expect(added).toEqual([])
    expect(host.get('.app-region').text()).toBe('')

    await toggle(true)
    expect(region.text()).toBe('')
    await settle()
    expect(added).toEqual([{ text: OFFLINE, open: true }])
  })

  it('says them again each time it opens, and empties its region as it closes', async () => {
    const { region, added, toggle } = await renderSpeaking({ strip: true })
    await toggle(true)
    await settle()
    await toggle(false)
    expect(region.text()).toBe('')
    await toggle(true)
    expect(region.text()).toBe('')
    await settle()
    expect(added.map((a) => a.text)).toEqual([OFFLINE, OFFLINE])
  })

  it('says nothing of a block gone before the opening', async () => {
    const { added, strip, toggle } = await renderSpeaking({ strip: true })
    strip.value = false
    await nextTick()
    await toggle(true)
    await settle()
    expect(added).toEqual([])
  })

  // An event — «Восстановлено» — is about a moment, not about what stands: in a shut sheet it is
  // said nowhere, and the opening does not bring it back.
  it('says an event of a shut sheet nowhere, then or at the opening', async () => {
    const { host, added, restored, toggle } = await renderSpeaking()
    restored.value = true
    await settle()
    await toggle(true)
    await settle()
    expect(added).toEqual([])
    expect(host.get('.app-region').text()).toBe('')
  })

  // A picker over a sheet (MOL-123): the sheet under it is inert too, so the top one takes the words —
  // and gives them back once it is down. The reason the open sheets are a list (review С-10).
  it('gives the words of the sheet under it to the sheet over it, and back once that one is down', async () => {
    const router: Router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    const under = ref(false)
    const over = ref(false)
    const words = ref<string | null>(null)
    const InUnder = defineComponent({
      setup() {
        const announce = useAnnouncer()
        watch(words, (now) => {
          if (now) announce?.(now)
        })
        return () => h('p', 'Трата')
      },
    })
    const host = mount(
      defineComponent({
        setup() {
          provideAnnouncer()
          return () => [
            h(
              BottomSheet,
              {
                open: under.value,
                class: 'under',
                'onUpdate:open': (next: boolean) => (under.value = next),
              },
              { title: () => 'Трата', default: () => h(InUnder) },
            ),
            h(
              BottomSheet,
              {
                open: over.value,
                back: true,
                class: 'over',
                'onUpdate:open': (next: boolean) => (over.value = next),
              },
              { title: () => 'Счёт', default: () => h('p', 'Наличные') },
            ),
          ]
        },
      }),
      { attachTo: document.body, global: { plugins: [router, createAppI18n('en')] } },
    )
    const region = (sheet: string) => host.get(`dialog.${sheet} .region`).text()

    under.value = true
    await nextTick()
    wait(1000)
    await settle()
    over.value = true
    await nextTick()
    wait(1000)
    await settle()
    words.value = 'Под выбором счёта'
    await settle()
    expect((host.get('dialog.under').element as HTMLDialogElement).open).toBe(true)
    expect(region('over')).toBe('Под выбором счёта')
    expect(region('under')).toBe('')

    over.value = false
    await nextTick()
    landed()
    await settle()
    words.value = 'Снова наверху'
    await settle()
    expect(region('under')).toBe('Снова наверху')
    expect(region('over')).toBe('')
  })

  // Under a modal sheet everything else is inert: a sheet's wrapper speaking from its own setup,
  // above its BottomSheet, or the screen under it, is said in the sheet (adversarial А3).
  it('says words from outside it in its own region while it is up, in the app’s once it is down', async () => {
    const { host, region, screen, toggle } = await renderSpeaking({ open: true })
    screen.value = 'За единицу: 800 ֏ за литр'
    await settle()
    expect(region.text()).toBe('За единицу: 800 ֏ за литр')
    expect(host.get('.app-region').text()).toBe('')

    await toggle(false)
    screen.value = 'Восстановлено'
    await settle()
    expect(host.get('.app-region').text()).toBe('Восстановлено')
  })
})
