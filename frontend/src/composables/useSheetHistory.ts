import { onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { stepBack } from '@/navigation'

/**
 * The entry an open sheet keeps in the history, so that «back» — Android's button, the browser's,
 * the iOS edge swipe — closes the sheet instead of leaving the screen under it.
 *
 * The entry is laid at the very same address, through the router's own history rather than a
 * bare `pushState`: the router keeps `position`, `back` and `current` in `history.state`, and the
 * rules of «back» read them (`entryBelow` in navigation.ts). A foreign state without them would
 * make the next step count from `undefined`. The scroll is not among the reasons: putting a sheet
 * away does not scroll at all (`scrollBehavior` in router.ts, MOL-63).
 *
 * Every close goes through the history. The ×, the scrim and Esc step back; only the pop that
 * follows actually closes it. So exactly one entry is ever taken away, and the «back» after a
 * closed sheet leaves the screen instead of closing it a second time.
 *
 * A move of the router while the sheet is open — a push, a replace, the same screen with another
 * query — closes it too: the sheet belonged to the place that was left. Its entry stays in the
 * history (nothing can be taken out of the middle of it), and the guard below steps over it when
 * «back» reaches it.
 */

interface Holder {
  left: () => void
}

/**
 * The open sheets of each router, the last opened on top. One listener per router reads the pop
 * and closes as many sheets from the top as entries it went back — a sheet over a sheet closes
 * alone. A listener per sheet cannot: each would take any pop for its own, and one that removed
 * itself inside the router's loop over them made the router skip the next (adversarial В-1).
 */
const stacks = new WeakMap<Router, Holder[]>()

function stackOf(router: Router): Holder[] {
  let stack = stacks.get(router)
  if (!stack) {
    const created: Holder[] = []
    stacks.set(router, created)
    router.options.history.listen((_to, _from, { delta }) => {
      // Back by `delta` entries; an unknown distance is one. Forward past an open sheet cannot
      // happen: laying its entry cut the forward history away.
      const count = Math.min(delta < 0 ? -delta : delta === 0 ? 1 : 0, created.length)
      for (const holder of created.splice(created.length - count, count).reverse()) {
        holder.left()
      }
    })
    stack = created
  }
  return stack
}

export function useSheetHistory(onLeft: () => void): {
  lay: () => void
  leave: (steps?: number) => void
  laid: () => boolean
} {
  const router = useRouter()
  const history = router.options.history
  const stack = stackOf(router)
  let holder: Holder | undefined
  let stopMoves: (() => void) | undefined
  // Whether the screen under the sheet has an entry of the app beneath it: `null` for a section
  // opened cold — a link from the bot — which is its own home.
  let screenBelow: unknown

  function forget(): void {
    stopMoves?.()
    stopMoves = undefined
    const at = holder ? stack.indexOf(holder) : -1
    if (at !== -1) stack.splice(at, 1)
    holder = undefined
  }

  /**
   * `replace` builds the new entry's state over the old one, so the sheet's flag travels to the
   * screen that replaced it — and the guard would then step over that screen as a dead entry
   * (MOL-18, adversarial Б-2). The flag is taken off the entry the move landed on.
   */
  function unmark(): void {
    if (history.state.sheet === true) history.replace(history.location, { sheet: false })
  }

  function lay(): void {
    if (holder) return
    const at = router.currentRoute.value.fullPath
    screenBelow = history.state.back
    history.push(at, { sheet: true })
    const own: Holder = {
      left: () => {
        forget()
        onLeft()
      },
    }
    holder = own
    stack.push(own)

    // A pop reaches the router's history listeners first — synchronously, while the router is
    // still resolving — and the stack closes this sheet and takes this hook away before the move
    // lands. So what arrives here is a move made while the sheet stood open: a push, a replace,
    // the same screen with a new query.
    //
    // Except the end of the pop that closed the previous sheet, when this one was opened again
    // before it finished («save and next»): that move lands on the very address the sheet stands
    // on. A push or replace to it is refused by the router as a duplicate, so a move there is
    // never a way out.
    stopMoves = router.afterEach((to, _from, failure) => {
      if (failure || to.fullPath === at) return
      forget()
      unmark()
      onLeft()
    })
  }

  /**
   * Steps back off the entry; the pop that follows closes the sheet. `steps` counts this sheet
   * and the screens under it: `close(2)` puts the sheet away and leaves the screen. Sheets are
   * entries too, so the ones over this sheet — and, when the screen is left, the ones under it —
   * are stepped over as well: `close(2)` from a sheet over a sheet leaves the screen, not just the
   * two sheets (adversarial round 4).
   *
   * Never out of the app: a section opened cold has nothing of ours beneath it, and `close(2)`
   * there only puts the sheet away (adversarial П-7).
   */
  function leave(steps = 1): void {
    if (!holder) {
      onLeft()
      return
    }
    const over = stack.length - stack.indexOf(holder)
    const screens = screenBelow === null ? 0 : steps - 1
    stepBack(router, screens > 0 ? stack.length + screens : over)
  }

  // Gone with its entry still laid and no move to tell of it — the screen was taken out of the
  // page some other way. The screen is still told the sheet is shut.
  onBeforeUnmount(() => {
    if (!holder) return
    forget()
    onLeft()
  })

  return { lay, leave, laid: () => holder !== undefined }
}

/**
 * Steps off a sheet's entry that no sheet holds — left by a reload on it, by «forward» onto it, by
 * a move away from an open sheet. Such an entry is the screen's address twice: «back» from it
 * stayed on the same screen, and worse, the rules of «back» read the screen under itself and a
 * tap on the chevron or on «Trip» replaced instead of stepping back (MOL-18, adversarial А-3).
 *
 * It steps on the way the pop went: arrived by «forward», it goes on forward if there is an entry
 * beyond — stepping back made that screen unreachable (adversarial В-4). The step takes the block
 * of «a step in flight» over (`force`): it runs inside the pop of a chevron's or a tab's step,
 * which still holds the block — waiting for it swallowed the guard (review Р-1), ignoring it let a
 * second tap in between the two pops (adversarial В-3).
 *
 * Installed once, at start — where a reload lands — and then on every pop.
 */
export function installSheetEntryGuard(router: Router): () => void {
  const history = router.options.history
  const stack = stackOf(router)
  const stepOff = (delta: number): void => {
    if (stack.length > 0 || history.state.sheet !== true) return
    // Forward only where there is somewhere to go: a step into nothing never lands, and the
    // block it holds swallowed the next close for a second.
    const onward = delta > 0 && typeof history.state.forward === 'string'
    stepBack(router, onward ? -1 : 1, true)
  }
  const stop = history.listen((_to, _from, { delta }) => {
    stepOff(delta)
  })
  stepOff(0)
  return stop
}
