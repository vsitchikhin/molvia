import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'

/**
 * Whether the browser believes it is online, read now and on every change — a statement about this
 * moment, never narrowed from a check made before (MOL-19). For words that say «нет связи» ahead of
 * time; whether a request failed offline is still decided after the failure.
 */
export function useOnline(): Ref<boolean> {
  const online = ref(navigator.onLine)
  const listen = () => {
    online.value = navigator.onLine
  }
  onMounted(() => {
    window.addEventListener('online', listen)
    window.addEventListener('offline', listen)
  })
  onUnmounted(() => {
    window.removeEventListener('online', listen)
    window.removeEventListener('offline', listen)
  })
  return online
}
