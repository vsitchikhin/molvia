import { onUnmounted, shallowRef, watch } from 'vue'
import type { Ref, ShallowRef } from 'vue'
import type { AppLocale, BarcodeHint } from '@molvia/model'
import { api } from '@/api'

export interface BarcodeHintState {
  /** The hint for `code` now, or `null`: none asked yet, none given, or the base out of reach. */
  readonly hint: ShallowRef<BarcodeHint | null>
}

/**
 * What Open Food Facts says the package of a code the catalogue missed is (MOL-162), following that
 * code: asked when a code starts waiting for its item, dropped when it stops — so the hint shown is
 * always the code's on screen, never the one before.
 *
 * Quiet on purpose: no loading, no error, no offline. The miss is already on screen and is the
 * answer; a hint that comes is a bonus, and one that does not — the base out of reach, the network
 * gone — leaves the screen exactly as it was without it.
 */
export function useBarcodeHint(code: Ref<string | null>, locale: Ref<AppLocale>): BarcodeHintState {
  const hint = shallowRef<BarcodeHint | null>(null)
  let inFlight: AbortController | undefined

  async function ask(read: string, language: AppLocale): Promise<void> {
    const controller = new AbortController()
    inFlight = controller
    try {
      const answer = await api.catalogueBarcodeHint(read, language, { signal: controller.signal })
      if (inFlight === controller) hint.value = answer
    } catch {
      // No hint is the answer to every failure.
    } finally {
      if (inFlight === controller) inFlight = undefined
    }
  }

  watch(
    [code, locale],
    ([read, language]) => {
      inFlight?.abort()
      inFlight = undefined
      hint.value = null
      if (read !== null) void ask(read, language)
    },
    { immediate: true },
  )

  onUnmounted(() => inFlight?.abort())

  return { hint }
}
