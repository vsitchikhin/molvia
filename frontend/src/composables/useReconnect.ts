import { onMounted, onUnmounted } from 'vue'

/**
 * Calls `retry` whenever the connection may have come back while the screen is shown: the
 * browser's `online`, and the app coming back into view. The second is not a nicety — an iOS
 * PWA frozen in the background misses `online` while the network returns, and a screen that
 * waited for it alone would sit on «no connection» with nothing to press (MOL-19, B2).
 *
 * `retry` decides for itself whether there is anything to retry: it is called on every such
 * moment, not only after a failure.
 */
export function useReconnect(retry: () => void): void {
  function onVisible(): void {
    if (document.visibilityState === 'visible') retry()
  }

  onMounted(() => {
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', onVisible)
  })

  onUnmounted(() => {
    window.removeEventListener('online', retry)
    document.removeEventListener('visibilitychange', onVisible)
  })
}
