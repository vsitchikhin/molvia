import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createRouter, createWebHistory, RouterView } from 'vue-router'
import type { Router } from 'vue-router'
import { createAppI18n } from '@/i18n'
import BottomSheet from '@/components/BottomSheet.vue'
import { installSheetEntryGuard } from '@/composables/useSheetHistory'
import { stepBack } from '@/navigation'
import { routes } from '@/router'

vi.mock('@/api', () => ({ api: { health: () => new Promise(() => undefined) } }))

/**
 * A web history: the guard reads the flag the sheet leaves in `history.state`, and only the web
 * history keeps a state. The window's own history outlives each test, so it is reset first.
 */
async function fresh(path: string): Promise<Router> {
  window.history.replaceState(null, '', path)
  const router = createRouter({ history: createWebHistory(), routes })
  await router.push(path)
  await router.isReady()
  return router
}

/** The dead entry a sheet leaves when the screen is left by a push with the sheet open. */
function layDeadEntry(router: Router): void {
  router.options.history.push(router.currentRoute.value.fullPath, { sheet: true })
}

async function landsOn(router: Router, path: string): Promise<void> {
  await vi.waitFor(() => {
    expect(router.currentRoute.value.fullPath).toBe(path)
    expect(router.options.history.state.sheet).not.toBe(true)
  })
}

const stops: (() => void)[] = []

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
})

describe('installSheetEntryGuard', () => {
  // A reload on the sheet's entry opens no sheet; the start steps off the entry.
  it('steps off a dead entry it starts on', async () => {
    const router = await fresh('/')
    await router.push('/trip/add')
    layDeadEntry(router)
    const go = vi.spyOn(router, 'go')
    stops.push(installSheetEntryGuard(router))
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
  })

  it('must not fire: an entry of its own is left alone', async () => {
    const router = await fresh('/')
    const go = vi.spyOn(router, 'go')
    stops.push(installSheetEntryGuard(router))
    expect(go).not.toHaveBeenCalled()
  })

  it('steps over a dead entry that the system «back» lands on', async () => {
    const router = await fresh('/')
    stops.push(installSheetEntryGuard(router))
    layDeadEntry(router)
    await router.push('/advice')
    router.back()
    await landsOn(router, '/')
  })

  // The chevron and the «Trip» tab step back through `stepBack`, and the guard runs inside that
  // pop, before the step has landed: going through `stepBack` it was swallowed (review Р-1).
  it('steps over a dead entry that a step of our own lands on', async () => {
    const router = await fresh('/')
    stops.push(installSheetEntryGuard(router))
    layDeadEntry(router)
    await router.push('/advice')
    stepBack(router)
    await landsOn(router, '/')
  })
})

describe('the sheet and the router', () => {
  // `replace` builds the new entry over the old one and carried the sheet's flag to the screen
  // that replaced it; the guard then stepped over that screen as a dead entry (adversarial Б-2).
  it('does not leave its flag on the screen that replaced the one it was open on', async () => {
    const router = await fresh('/')
    await router.push('/advice')
    stops.push(installSheetEntryGuard(router))
    const open = ref(true)
    const view = mount(
      defineComponent(() => () => [
        h(RouterView),
        h(
          BottomSheet,
          { open: open.value, 'onUpdate:open': (next: boolean) => (open.value = next) },
          { title: () => 'Milk' },
        ),
      ]),
      {
        attachTo: document.body,
        global: { plugins: [router, createPinia(), createAppI18n('en')] },
      },
    )
    await nextTick()
    expect(router.options.history.state.sheet).toBe(true)

    await router.replace('/verdicts')
    expect(open.value).toBe(false)
    expect(router.options.history.state.sheet).not.toBe(true)

    await router.push('/trip/add')
    router.back()
    await landsOn(router, '/verdicts')
    view.unmount()
  })

  // A section opened cold — a link from the bot — has nothing of ours beneath it; `close(2)` there
  // only puts the sheet away instead of leaving the app (adversarial П-7).
  it('close(2) never steps out of the app', async () => {
    const router = await fresh('/verdicts')
    expect(router.options.history.state.back).toBeNull()
    const open = ref(true)
    const view = mount(
      defineComponent(() => () => [
        h(RouterView),
        h(
          BottomSheet,
          { open: open.value, 'onUpdate:open': (next: boolean) => (open.value = next) },
          { title: () => 'Milk' },
        ),
      ]),
      {
        attachTo: document.body,
        global: { plugins: [router, createPinia(), createAppI18n('en')] },
      },
    )
    await nextTick()
    const go = vi.spyOn(router, 'go')
    ;(view.findComponent(BottomSheet).vm as unknown as { close: (steps: number) => void }).close(2)
    expect(go).toHaveBeenCalledExactlyOnceWith(-1)
    await landsOn(router, '/verdicts')
    view.unmount()
  })
})
