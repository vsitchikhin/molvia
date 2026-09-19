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
 * lands below the sheet's entry actually closes it. So exactly one entry is ever taken away, and
 * the «back» after a closed sheet leaves the screen instead of closing it a second time.
 */

/** How many sheets hold an entry right now — the guard below needs to know none does. */
let holding = 0

export function useSheetHistory(onLeft: () => void): {
  lay: () => void
  leave: (steps?: number) => void
  laid: () => boolean
} {
  const router = useRouter()
  const history = router.options.history
  let stopListening: (() => void) | undefined

  function forget(): void {
    if (!stopListening) return
    stopListening()
    stopListening = undefined
    holding -= 1
  }

  function lay(): void {
    if (stopListening) return
    history.push(router.currentRoute.value.fullPath, { sheet: true })
    // Known by where it lies, not by its flag: an entry left over from a reload carries the same
    // flag, and a close that stepped back onto it took it for this sheet's entry — the sheet
    // stayed open (MOL-18, adversarial А-1).
    const laidAt: unknown = history.state.position
    holding += 1
    stopListening = history.listen(() => {
      const at: unknown = history.state.position
      if (typeof at === 'number' && typeof laidAt === 'number' && at >= laidAt) return
      forget()
      onLeft()
    })
  }

  /** Steps back off the entry; the pop that follows closes the sheet. */
  function leave(steps = 1): void {
    if (!stopListening) {
      onLeft()
      return
    }
    stepBack(router, steps)
  }

  // Gone with its entry still laid: the screen was left by a push, not a pop — the pop would
  // have taken the entry first. The entry cannot be taken out of the middle of the history; the
  // guard steps over it when «back» reaches it. The screen is still told the sheet is shut, or a
  // store holding `open` would open it again on the way back.
  onBeforeUnmount(() => {
    if (!stopListening) return
    forget()
    onLeft()
  })

  return { lay, leave, laid: () => stopListening !== undefined }
}

/**
 * Steps off a sheet's entry that no sheet holds — left by a reload on it, by «forward» onto it, by
 * a push away from an open sheet. Such an entry is the screen's address twice: «back» from it
 * stayed on the same screen, and worse, the rules of «back» read the screen under itself and a
 * tap on the chevron or on «Trip» replaced instead of stepping back (MOL-18, adversarial А-3).
 *
 * Installed once, at start — where a reload lands — and then on every pop.
 */
export function installSheetEntryGuard(router: Router): void {
  const history = router.options.history
  const stepOff = (): void => {
    if (holding === 0 && history.state.sheet === true) stepBack(router)
  }
  history.listen(stepOff)
  stepOff()
}
