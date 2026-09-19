import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import type { RouteName, Tab } from '@/router'

/**
 * How a tap on a tab is written into the history.
 *
 * The trip is home — it is the main scenario. Leaving it pushes, moving between the other
 * sections replaces, and coming back to it is a step back. So the system «back» on Android
 * walks «Ratings → Trip → out of the app» however many tabs were tapped in between, which is
 * what Android apps do, and an iPhone, with no such button, sees no difference.
 *
 * `top` is a tap on the section already open: iOS scrolls it to the top, and nothing in a
 * browser stands in the way of doing the same.
 */
export type TabMove = 'push' | 'replace' | 'back' | 'top'

export function tabMove(from: Tab | undefined, to: Tab, back: string | null): TabMove {
  if (from === to) return 'top'
  if (to === 'trip') return back === '/' ? 'back' : 'replace'
  return from === 'trip' ? 'push' : 'replace'
}

/**
 * Where the back chevron leads: one step back when the entry underneath is the parent — the
 * very step the system button takes, so the two never disagree — and otherwise a replace onto
 * the parent, so the chevron never leads out of the app.
 */
export type BackMove = 'back' | { replace: RouteName }

export function backMove(parent: RouteName, parentPath: string, back: string | null): BackMove {
  return back === parentPath ? 'back' : { replace: parent }
}

/** The entry underneath the current one, as vue-router records it in the history state. */
function entryBelow(router: Router): string | null {
  const back: unknown = router.options.history.state.back
  return typeof back === 'string' ? back : null
}

/**
 * A nested screen opened cold — a reload, a tab the phone unloaded and restored, a link — has
 * nothing of ours underneath, and the system «back» would leave the app while the chevron
 * promises the parent. The parent is laid underneath, out of sight, before the first paint:
 * one replace onto it, one push back onto the screen.
 */
export async function settleColdStart(router: Router): Promise<void> {
  await router.isReady()
  const route = router.currentRoute.value
  const parent = route.meta.parent
  if (!parent || entryBelow(router) !== null) return

  const target = route.fullPath
  await router.replace({ name: parent })
  await router.push(target)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useNavigation(): {
  goTab: (to: Tab) => Promise<void>
  goBack: () => Promise<void>
} {
  const router = useRouter()
  const route: RouteLocationNormalizedLoaded = useRoute()

  async function goTab(to: Tab): Promise<void> {
    const move = tabMove(route.meta.tab, to, entryBelow(router))
    if (move === 'top') {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    } else if (move === 'back') {
      router.back()
    } else {
      await router[move]({ name: to })
    }
  }

  async function goBack(): Promise<void> {
    const parent = route.meta.parent
    if (!parent) return
    const move = backMove(parent, router.resolve({ name: parent }).fullPath, entryBelow(router))
    if (move === 'back') router.back()
    else await router.replace({ name: move.replace })
  }

  return { goTab, goBack }
}
