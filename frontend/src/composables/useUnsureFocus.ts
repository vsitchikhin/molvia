import { onUnmounted, watch } from 'vue'
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAnnouncer } from '@/composables/useAnnouncer'

/**
 * What a row saved on the tap does while its change is unsure (MOL-96, rounds 3–4, Р3-А2, №7, №10):
 * the control goes, and the focus a tap left on it would fall to the page — it waits on the line
 * that says why (`line`, `tabindex="-1"`) and goes back to the control once the answer is known, if
 * it is still nowhere. The words are said in the app's one live region only when the line does not
 * take the focus, which reads them: said twice, they were heard twice.
 *
 * `holder` is what holds the control while it is there; its first `input` takes the focus back.
 */
export function useUnsureFocus(
  unsure: Ref<boolean>,
  pending: Ref<boolean>,
  holder: () => HTMLElement | null | undefined,
  line: () => HTMLElement | null | undefined,
): void {
  const { t } = useI18n()
  const announce = useAnnouncer()
  let heldFocus = false
  let withdraw: (() => void) | undefined
  // Read at the turn itself, while the control is still on the page: a check that answers at once
  // turns it back before any render, and a watcher run at the render would see neither turn.
  watch(
    unsure,
    (now) => {
      withdraw?.()
      withdraw = undefined
      if (!now) return
      heldFocus = !!holder()?.contains(document.activeElement)
      if (!heldFocus)
        withdraw = announce?.(t(pending.value ? 'settings.tap.waiting' : 'settings.tap.unsure'))
    },
    { flush: 'sync' },
  )
  // Acted on once the page is drawn: the line is there to take the focus, the control to get it back.
  watch(
    unsure,
    (now) => {
      if (!heldFocus) return
      if (now) {
        line()?.focus({ preventScroll: true })
        return
      }
      heldFocus = false
      // Only a focus left with nowhere to be — on the page, or on what has just left it; one the
      // person moved meanwhile stays where it is.
      const active = document.activeElement
      if (active === null || active === document.body || !active.isConnected)
        holder()?.querySelector('input')?.focus({ preventScroll: true })
    },
    { flush: 'post' },
  )
  onUnmounted(() => withdraw?.())
}
