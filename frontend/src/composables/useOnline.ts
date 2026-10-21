import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'

/**
 * Whether the browser believes it is online, read now and on every change — a statement about this
 * moment, never narrowed from a check made before (MOL-19). For words that say «нет связи» ahead of
 * time; whether a request failed offline is still decided after the failure.
 *
 * Read again when the app comes back into view, as `useReconnect` asks again then: an iOS PWA frozen
 * in the background misses `online` and `offline` both, and «Задать план можно со связью» stood over
 * the answer the server had just given on the return (MOL-192, adversarial А1, А1′).
 */
export function useOnline(): Ref<boolean> {
  const online = ref(navigator.onLine)
  const listen = () => {
    online.value = navigator.onLine
  }
  onMounted(() => {
    window.addEventListener('online', listen)
    window.addEventListener('offline', listen)
    document.addEventListener('visibilitychange', listen)
    window.addEventListener('pageshow', listen)
  })
  onUnmounted(() => {
    window.removeEventListener('online', listen)
    window.removeEventListener('offline', listen)
    document.removeEventListener('visibilitychange', listen)
    window.removeEventListener('pageshow', listen)
  })
  return online
}
