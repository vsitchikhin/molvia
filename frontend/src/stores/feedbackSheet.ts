import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WireCode } from '@molvia/model'

/**
 * Where «Написать разработчику» was opened from (MOL-147): the settings, an error screen, or a receipt
 * the scanner read badly (MOL-222, В-2) — whose photos go with it, seen before sending.
 */
export type FeedbackEntry =
  | { readonly from: 'settings' }
  | { readonly from: 'error'; readonly code: WireCode | null }
  | { readonly from: 'receipt' }

/**
 * The one sheet «Написать разработчику» of the app (MOL-147), opened from either way in. The way in
 * is the opening's, never the draft's (Р-6): written from an error screen, closed and finished from
 * the settings, the message goes without the code — and the sheet says so before it is sent.
 */
export const useFeedbackSheetStore = defineStore('feedbackSheet', () => {
  const shown = ref(false)
  const entry = ref<FeedbackEntry>({ from: 'settings' })
  /**
   * The photos of a receipt to go with the message (MOL-222, В-2): taken by the sheet as it opens,
   * drawn anew like a picture from the gallery and shown before sending — the person's own act all the
   * same, and a photo the system camera took is in no gallery to choose from.
   */
  const photos = ref<readonly Blob[]>([])

  function open(from: FeedbackEntry, attached: readonly Blob[] = []): void {
    entry.value = from
    photos.value = attached
    shown.value = true
  }

  /** The photos handed over once: the sheet holds them from here, as it holds a picture chosen. */
  function takePhotos(): readonly Blob[] {
    const taken = photos.value
    photos.value = []
    return taken
  }

  return { shown, entry, open, takePhotos }
})
