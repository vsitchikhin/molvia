import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

/** Says the words; the returned function takes them back before their time. */
type Announce = (text: string) => () => void

interface Announcement {
  id: number
  text: string
}

const announcerKey: InjectionKey<Announce> = Symbol('announcer')

// The words land a task after anything else changed. A screen reader reads the accessibility
// tree between tasks: a region and its words born in one task are one thing to it, «a region
// born with its words», which is often not read at all (MOL-19, П-2, C2).
const DELAY_MS = 100

// Then they go. The region is hidden but in the reading order, and words left in it are read
// in browse mode as if they were still true — «Loading…» under an error (C3).
const LINGER_MS = 7000

/**
 * The app's one polite live region, there from the first frame and through every screen —
 * which is why it lives above the router, not in the screen: a region remounted with each
 * screen is born with that screen's first words.
 *
 * Every announcement is a node of its own, added and later removed. An addition is what gets
 * read, so the same words said twice are read twice — «Try again» failing the same way is
 * still an answer (C1); a removal is not read, so taking words back is silent. A block takes
 * its words back when it goes, so the region never holds what is no longer on the screen.
 */
export function provideAnnouncer(): Ref<Announcement[]> {
  const announcements = ref<Announcement[]>([])
  let next = 0

  provide(announcerKey, (text) => {
    const id = next++
    let lingering: ReturnType<typeof setTimeout> | undefined

    function remove(): void {
      clearTimeout(adding)
      clearTimeout(lingering)
      announcements.value = announcements.value.filter((announcement) => announcement.id !== id)
    }

    const adding = setTimeout(() => {
      announcements.value = [...announcements.value, { id, text }]
      lingering = setTimeout(remove, LINGER_MS)
    }, DELAY_MS)

    return remove
  })

  return announcements
}

/** The app's live region, or nothing outside the app — then a block speaks for itself. */
export function useAnnouncer(): Announce | undefined {
  return inject(announcerKey, undefined)
}
