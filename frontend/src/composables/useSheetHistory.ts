import { onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { stepBack } from '@/navigation'

/**
 * The entry an open sheet keeps in the history, so that «back» — Android's button, the browser's,
 * the iOS edge swipe — closes the sheet instead of leaving the screen under it.
 *
 * The entry is laid at the very same address, through the router's own history rather than a
 * bare `pushState`: the router keeps `position`, `back` and `current` in `history.state`, and the
 * rules of «back» read them (`entryBelow` in navigation.ts). A foreign state without them would
 * make the next step count from `undefined`.
 *
 * Every close goes through the history. The ×, the scrim and Esc step back; only the pop that
 * lands off the sheet's entry actually closes it. So exactly one entry is ever taken away, and
 * the «back» after a closed sheet leaves the screen instead of closing it a second time.
 *
 * A reload on the entry opens no sheet — an entry is not an address — and the «back» from it
 * stays on the same screen once. That is accepted, and the navigation fix of MOL-18 keeps it from
 * moving the scroll or the focus.
 */
export function useSheetHistory(onLeft: () => void): {
  lay: () => void
  leave: (steps?: number) => void
  laid: () => boolean
} {
  const router = useRouter()
  const history = router.options.history
  let stopListening: (() => void) | undefined

  function forget(): void {
    stopListening?.()
    stopListening = undefined
  }

  function lay(): void {
    if (stopListening) return
    history.push(router.currentRoute.value.fullPath, { sheet: true })
    stopListening = history.listen(() => {
      // Forward onto the entry again is not a close: nothing is open to close.
      if (history.state.sheet === true) return
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

  // A screen that goes away with the sheet still open — the pop took it — has nothing left to
  // step off: the same pop already took the entry.
  onBeforeUnmount(forget)

  return { lay, leave, laid: () => stopListening !== undefined }
}
