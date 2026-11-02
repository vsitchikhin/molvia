import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import { useReconnect } from '@/composables/useReconnect'
import { localDay } from '@/days'

/**
 * The phone's today as a screen holds it (MOL-121, adversarial Н): looked at again whenever the app
 * comes back into view or online, as the month of «Деньги» is (adversarial З), **and at midnight with
 * the screen in view** (MOL-329, adversarial А4). An installed app left on a screen overnight came back
 * with yesterday's salary still «Сегодня» — a default argument is read once, and nothing on the screen
 * asked again; and a screen read the clock where a word was drawn, so after midnight whatever happened
 * to be redrawn — a strip after «Повторить» — said «вчера» over rows still «сегодня». Every day word of
 * a screen is counted from this one value, so they move together or not at all.
 */
export function useLocalDay(): Ref<string> {
  const today = ref(localDay())
  let midnight: ReturnType<typeof setTimeout> | undefined

  function look(): void {
    today.value = localDay()
    clearTimeout(midnight)
    // A timer of a page put away is held by the browser; coming back into view looks again anyway.
    midnight = setTimeout(look, untilMidnight())
  }

  useReconnect(look)
  onMounted(look)
  onUnmounted(() => {
    clearTimeout(midnight)
  })
  return today
}

/** Milliseconds to the next local midnight, and a little past it, so the day has turned when it fires. */
function untilMidnight(now = new Date()): number {
  const next = new Date(now)
  // Hour 24 is the next day's midnight, an hour of summer time added or taken away included.
  next.setHours(24, 0, 0, 0)
  return next.getTime() - now.getTime() + MIDNIGHT_SLACK_MS
}

// A timer may fire a little early; looking a moment past midnight finds the new day, and if it is still
// the old one the next look is set again.
const MIDNIGHT_SLACK_MS = 500
