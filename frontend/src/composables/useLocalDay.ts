import { ref } from 'vue'
import type { Ref } from 'vue'
import { useReconnect } from '@/composables/useReconnect'
import { localDay } from '@/days'

/**
 * The phone's today as a screen holds it (MOL-121, adversarial Н): looked at again whenever the app
 * comes back into view or online, as the month of «Деньги» is (adversarial З). An installed app left
 * on a screen overnight came back with yesterday's salary still «Сегодня» — a default argument is
 * read once, and nothing on the screen asked again.
 */
export function useLocalDay(): Ref<string> {
  const today = ref(localDay())
  useReconnect(() => {
    today.value = localDay()
  })
  return today
}
