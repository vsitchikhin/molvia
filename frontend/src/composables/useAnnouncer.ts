import { inject, onBeforeUnmount, provide, ref, watch, type InjectionKey, type Ref } from 'vue'

interface Say {
  /**
   * Words of what stands on the screen — a state, a strip, «Loading…» — rather than of what just
   * happened. In a sheet they are said again each time it opens, for as long as the block holds them:
   * a sheet is mounted closed with the screen, and words said while it is shut reach no one.
   */
  held?: boolean
}

/** Says the words; the returned function takes them back before their time. */
type Announce = (text: string, options?: Say) => () => void

interface Announcement {
  id: number
  text: string
}

/** A sheet's region, and whether the sheet is up. */
interface Sheet {
  announcements: Ref<Announcement[]>
  shown: Ref<boolean>
  /** Held words of the blocks inside: what to say on opening and take out on closing. */
  held: Set<{ put(): void; unsay(): void }>
}

/** The regions of the app: its own, and the sheets open over it, the top one last. */
interface Hub {
  app: Ref<Announcement[]>
  open: Sheet[]
  next: number
}

const announcerKey: InjectionKey<Announce> = Symbol('announcer')
const hubKey: InjectionKey<Hub> = Symbol('announcer-hub')

// The words land a task after anything else changed. A screen reader reads the accessibility
// tree between tasks: a region and its words born in one task are one thing to it, «a region
// born with its words», which is often not read at all (MOL-19, П-2, C2).
const DELAY_MS = 100

// Then they go. The region is hidden but in the reading order, and words left in it are read
// in browse mode as if they were still true — «Loading…» under an error (C3).
export const LINGER_MS = 7000

/**
 * Where words said now are read (MOL-181). Under an open modal sheet everything else is inert, so
 * the top open sheet's region, whoever speaks — a block inside it, the sheet's own wrapper above its
 * `BottomSheet`, the screen under it. With no sheet up, the app's. A block inside a closed sheet is
 * said nowhere: its dialog is out of the accessibility tree.
 */
function regionFor(hub: Hub, home: Sheet | null): Ref<Announcement[]> | null {
  if (home && !home.shown.value) return null
  return hub.open.at(-1)?.announcements ?? hub.app
}

function speak(hub: Hub, home: Sheet | null, text: string, held: boolean): () => void {
  let adding: ReturnType<typeof setTimeout> | undefined
  let lingering: ReturnType<typeof setTimeout> | undefined
  let node: { region: Ref<Announcement[]>; id: number } | undefined

  function unsay(): void {
    clearTimeout(adding)
    clearTimeout(lingering)
    if (!node) return
    const { region, id } = node
    region.value = region.value.filter((announcement) => announcement.id !== id)
    node = undefined
  }

  // The region is chosen as the words land, not as they are asked: a sheet may open or close
  // between the two.
  function put(): void {
    unsay()
    adding = setTimeout(() => {
      const region = regionFor(hub, home)
      if (!region) return
      node = { region, id: hub.next++ }
      region.value = [...region.value, { id: node.id, text }]
      lingering = setTimeout(unsay, LINGER_MS)
    }, DELAY_MS)
  }

  put()
  if (!held || !home) return unsay
  const entry = { put, unsay }
  home.held.add(entry)
  return () => {
    home.held.delete(entry)
    unsay()
  }
}

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
  const hub: Hub = { app: ref<Announcement[]>([]), open: [], next: 0 }
  provide(hubKey, hub)
  provide(announcerKey, (text, options) => speak(hub, null, text, options?.held ?? false))
  return hub.app
}

/**
 * A sheet's own region (MOL-181): the app's is outside the modal `<dialog>` and inert while it is
 * open (feedback С-10). While the sheet is up, everything said anywhere is said here; the blocks
 * inside it say their held words again on every opening, a task after it, into a region that is
 * emptied on closing — never a region shown already holding words. Outside the app the sheet has a
 * hub of its own.
 */
export function provideSheetAnnouncer(shown: Ref<boolean>): Ref<Announcement[]> {
  const hub = inject(hubKey, null) ?? { app: ref<Announcement[]>([]), open: [], next: 0 }
  const sheet: Sheet = { announcements: ref<Announcement[]>([]), shown, held: new Set() }

  function close(): void {
    hub.open = hub.open.filter((other) => other !== sheet)
    for (const entry of sheet.held) entry.unsay()
    sheet.announcements.value = []
  }

  watch(
    shown,
    (up) => {
      if (!up) {
        close()
        return
      }
      hub.open = [...hub.open.filter((other) => other !== sheet), sheet]
      for (const entry of sheet.held) entry.put()
    },
    { immediate: true },
  )
  onBeforeUnmount(close)

  provide(announcerKey, (text, options) => speak(hub, sheet, text, options?.held ?? false))
  return sheet.announcements
}

/** The app's live region, or nothing outside the app — then a block speaks for itself. */
export function useAnnouncer(): Announce | undefined {
  return inject(announcerKey, undefined)
}
