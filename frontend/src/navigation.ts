import { useRoute, useRouter } from 'vue-router'
import type { RouteLocationNormalizedLoaded, RouteParams, Router } from 'vue-router'
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

export function tabMove(from: Tab | undefined, to: Tab, below: RouteName | undefined): TabMove {
  if (from === to) return 'top'
  if (to === 'trip') return below === 'trip' ? 'back' : 'replace'
  return from === 'trip' ? 'push' : 'replace'
}

/**
 * Where the back chevron leads: one step back when the entry underneath is the parent — the
 * very step the system button takes, so the two never disagree — and otherwise a replace onto
 * the parent, so the chevron never leads out of the app.
 */
export type BackMove = 'back' | { replace: RouteName }

export function backMove(parent: RouteName, below: RouteName | undefined): BackMove {
  return below === parent ? 'back' : { replace: parent }
}

/**
 * Which screen the entry underneath the current one is — by route, never by address. The
 * history records the address whole, and `/?utm_source=telegram` or `/#top` is the trip as
 * much as `/` is; a string compared with `'/'` took them for somewhere else, and «back» from
 * the trip then led to the trip again.
 */
function entryBelow(router: Router): RouteName | undefined {
  const back: unknown = router.options.history.state.back
  if (typeof back !== 'string') return undefined
  const name = router.resolve(back).name
  return typeof name === 'string' ? (name as RouteName) : undefined
}

/**
 * Where a parent is, with the parameters it needs. Taken from the route below rather than
 * listed: this used to be spelled out in `settleColdStart` and in `goBack` both, and the next
 * parameterised parent would have had to be added twice — a place forgotten there breaks «назад»
 * with nothing on screen to say so (З-9).
 */
function parentOf(
  router: Router,
  route: { meta: { parent?: RouteName }; params: RouteParams },
): ReturnType<Router['resolve']> | null {
  const parent = route.meta.parent
  return parent ? router.resolve({ name: parent, params: route.params }) : null
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
  if (!parent || router.options.history.state.back) return

  const ancestors: string[] = []
  let cursor = router.resolve(route.fullPath)
  let ancestor = parentOf(router, cursor)
  while (ancestor) {
    ancestors.unshift(ancestor.fullPath)
    cursor = ancestor
    ancestor = parentOf(router, cursor)
  }
  const root = ancestors.shift()
  if (!root) return
  await router.replace(root)
  for (const path of ancestors) await router.push(path)
  await router.push(route.fullPath)
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * A step back is taken the moment it is asked for, but the history only moves on `popstate`.
 * A second tap in between still sees the parent underneath and steps past it, out of the app —
 * so until the step lands, further moves are ignored. The timer only guards against a step that
 * never lands.
 *
 * Exported for the sheet (MOL-18): closing it takes its own entry away, and closing it together
 * with the screen under it — «Add to trip» on the search — takes two in one move.
 *
 * The block is a token rather than a flag. The sheet's guard steps over a dead entry from inside
 * the pop of a step already in flight — the chevron's — and takes the block over with `force`: the
 * first step's landing must not lift the block that now belongs to the guard's step, or a second
 * tap on the chevron slipped through between the two pops (adversarial В-3).
 */
let stepping: object | null = null

/** Moves `steps` entries back — or forward, if negative — once no other step is in flight. */
export function stepBack(router: Router, steps = 1, force = false): void {
  if (stepping && !force) return
  const token = {}
  stepping = token
  const landed = (): void => {
    if (stepping === token) stepping = null
    window.clearTimeout(timer)
    window.removeEventListener('popstate', landed)
  }
  const timer = window.setTimeout(landed, 1000)
  window.addEventListener('popstate', landed)
  router.go(-steps)
}

export function useNavigation(): {
  goTab: (to: Tab) => Promise<void>
  goBack: () => Promise<void>
} {
  const router = useRouter()
  const route: RouteLocationNormalizedLoaded = useRoute()

  async function goTab(to: Tab): Promise<void> {
    if (stepping) return
    const move = tabMove(route.meta.tab, to, entryBelow(router))
    if (move === 'top') {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    } else if (move === 'back') {
      stepBack(router)
    } else {
      await router[move]({ name: to })
    }
  }

  async function goBack(): Promise<void> {
    const parent = route.meta.parent
    if (!parent || stepping) return
    const destination = parentOf(router, route)
    if (!destination) return
    const below: unknown = router.options.history.state.back
    const matches = typeof below === 'string' && router.resolve(below).path === destination.path
    const move = backMove(parent, matches ? parent : undefined)
    if (move === 'back') stepBack(router)
    else await router.replace(destination.fullPath)
  }

  return { goTab, goBack }
}
