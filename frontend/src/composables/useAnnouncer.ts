import { inject, nextTick, provide, ref, type InjectionKey, type Ref } from 'vue'

type Announce = (text: string) => void

const announcerKey: InjectionKey<Announce> = Symbol('announcer')

/**
 * The screen's one polite live region, there from the moment the screen is. A region inserted
 * together with its words is often not read at all — VoiceOver on iOS skips it — so a state
 * does not carry its own `role="status"`: it hands its words to the region that already
 * exists, and the change is what gets read (MOL-19, П-2).
 *
 * Words handed over in one tick are read as one: the identity notice and the screen's state
 * appear together, and the second must not overwrite the first. Emptied first, so the same
 * words announced twice in a row are read twice.
 */
export function provideAnnouncer(): Ref<string> {
  const announcement = ref('')
  let pending: string[] = []

  provide(announcerKey, (text) => {
    if (pending.length === 0) {
      announcement.value = ''
      void nextTick(() => {
        announcement.value = pending.join(' ')
        pending = []
      })
    }
    pending.push(text)
  })

  return announcement
}

/** The screen's live region, or nothing outside a screen — then a block speaks for itself. */
export function useAnnouncer(): Announce | undefined {
  return inject(announcerKey, undefined)
}
