import { onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import type { Router } from 'vue-router'
import { stepBack } from '@/navigation'

/**
 * The entry an open sheet keeps in the history, so that «back» — Android's button, the browser's,
 * the iOS edge swipe — closes the sheet instead of leaving the screen under it.
 *
 * The entry is laid at the very same address, through the router's own history rather than a
 * bare `pushState`: the router keeps `position`, `back`, `current` and the scroll in
 * `history.state`, and the rules of «back» read them (`entryBelow` in navigation.ts). A foreign
 * state without them would make the next step count from `undefined` and drop the list to the top.
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

/** How many sheets hold an entry right now — the guard below needs to know none does. */
let holding = 0

/** Why the sheet was put away: a pop or a move under it, or the screen going away with it. */
export type LeftBy = 'history' | 'unmount'

export function useSheetHistory(onLeft: (by: LeftBy) => void): {
  lay: () => void
  leave: (steps?: number) => void
  laid: () => boolean
} {
  const router = useRouter()
  const history = router.options.history
  let release: (() => void) | undefined

  function forget(): void {
    if (!release) return
    release()
    release = undefined
    holding -= 1
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
    if (release) return
    const at = router.currentRoute.value.fullPath
    history.push(at, { sheet: true })
    holding += 1

    // Pops while the sheet is on top can only go down, off its entry: the push cut the forward
    // history away. Whatever the pop, the sheet is left.
    const stopListening = history.listen(() => {
      forget()
      onLeft('history')
    })
    // A pop reaches the listener above first — synchronously, while the router is still resolving
    // — and `forget` takes this hook away before the move lands. So what arrives here is a move
    // made while the sheet stood open: a push, a replace, the same screen with a new query.
    //
    // Except the end of the pop that closed the previous sheet, when this one was opened again
    // before it finished («save and next»): that move lands on the very address the sheet stands
    // on. A push or replace to it is refused by the router as a duplicate, so a move there is
    // never a way out.
    const stopMoves = router.afterEach((to, _from, failure) => {
      if (failure || to.fullPath === at) return
      forget()
      unmark()
      onLeft('history')
    })
    release = () => {
      stopListening()
      stopMoves()
    }
  }

  /** Steps back off the entry; the pop that follows closes the sheet. */
  function leave(steps = 1): void {
    if (!release) {
      onLeft('history')
      return
    }
    stepBack(router, steps)
  }

  // Gone with its entry still laid and no move to tell of it — the screen was taken out of the
  // page some other way. The screen is still told the sheet is shut.
  onBeforeUnmount(() => {
    if (!release) return
    forget()
    onLeft('unmount')
  })

  return { lay, leave, laid: () => release !== undefined }
}

/**
 * Steps off a sheet's entry that no sheet holds — left by a reload on it, by «forward» onto it, by
 * a move away from an open sheet. Such an entry is the screen's address twice: «back» from it
 * stayed on the same screen, and worse, the rules of «back» read the screen under itself and a
 * tap on the chevron or on «Trip» replaced instead of stepping back (MOL-18, adversarial А-3).
 *
 * The step is the router's own, not `stepBack`: this runs inside the pop that a chevron or a tab
 * started through `stepBack`, before that step has landed, and `stepBack` refuses a second step
 * while one is in flight — the guard was swallowed exactly when the chevron led onto a dead entry
 * (review Р-1, adversarial Б-1).
 *
 * Installed once, at start — where a reload lands — and then on every pop.
 */
export function installSheetEntryGuard(router: Router): () => void {
  const history = router.options.history
  const stepOff = (): void => {
    if (holding === 0 && history.state.sheet === true) router.go(-1)
  }
  const stop = history.listen(stepOff)
  stepOff()
  return stop
}
