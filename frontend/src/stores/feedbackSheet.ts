import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WireCode } from '@molvia/model'

/** Where «Написать разработчику» was opened from (MOL-147): the settings, or an error screen. */
export type FeedbackEntry =
  { readonly from: 'settings' } | { readonly from: 'error'; readonly code: WireCode | null }

/**
 * The one sheet «Написать разработчику» of the app (MOL-147), opened from either way in. The way in
 * is the opening's, never the draft's (Р-6): written from an error screen, closed and finished from
 * the settings, the message goes without the code — and the sheet says so before it is sent.
 */
export const useFeedbackSheetStore = defineStore('feedbackSheet', () => {
  const shown = ref(false)
  const entry = ref<FeedbackEntry>({ from: 'settings' })

  function open(from: FeedbackEntry): void {
    entry.value = from
    shown.value = true
  }

  return { shown, entry, open }
})
