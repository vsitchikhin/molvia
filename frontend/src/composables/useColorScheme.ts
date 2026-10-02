import { readonly, ref } from 'vue'
import type { Ref } from 'vue'
import { read, writeEverywhere, writeOwn } from '@/stores/storage'

/**
 * The scheme this device is drawn in (MOL-111): the system's, or one the person chose. A property
 * of the screen, not of the account — kept on the device, never sent, and left in place by «Выйти»
 * and by erasure, like the keyboard's remembered height: it says nothing about the person.
 */
export type Scheme = 'system' | 'light' | 'dark'

/**
 * Read twice: here, and by the script in `index.html` that sets the scheme before the first paint —
 * the one reader of storage outside `storage.ts`. A module is deferred, and the browser may paint
 * before it runs. `useColorScheme.test.ts` runs that script and holds the two to one answer.
 */
export const SCHEME_KEY = 'molvia.scheme'

/** Anything but the two — `system`, nothing, an old or foreign value — is the system's scheme. */
function schemeOf(value: string | null): Scheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function storedScheme(): Scheme {
  return schemeOf(read(SCHEME_KEY))
}

/**
 * Every choice is written, «Системная» too, and on both shelves. Not a removed key: the shared shelf
 * is read first, and only an empty one lets a tab's own past through — a tab that kept «Тёмная» and
 * missed «Системная» (unloaded, closed and brought back) came back dark at every reload (adversarial
 * В). Everywhere, or the past goes: a shared shelf that refused the write but kept its old value
 * answered that value after a reload — the choice the person had just left (adversarial Б).
 */
function keep(scheme: Scheme): void {
  writeEverywhere(SCHEME_KEY, scheme)
}

/**
 * Marks the root for the tokens and points the status bar at the scheme. The two theme-color tags
 * keep their colours — each names its own scheme (`data-scheme-of`) — and only their `media`
 * moves: the chosen one always, the other never, both back to the system for «Системная». A copy
 * of the colours here would be a third place to drift from `_tokens.scss`.
 */
export function applyScheme(scheme: Scheme, page: Document = document): void {
  const root = page.documentElement
  if (scheme === 'system') delete root.dataset.scheme
  else root.dataset.scheme = scheme
  for (const meta of page.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = meta.dataset.schemeOf
    if (!own) continue
    meta.setAttribute(
      'media',
      scheme === 'system' ? `(prefers-color-scheme: ${own})` : own === scheme ? 'all' : 'not all',
    )
  }
}

const current = ref<Scheme>('system')

/**
 * Takes the stored choice and follows the other windows of the app: `storage` fires in each of them
 * but the one that wrote. The value is the event's — the shared shelf's — and only this window's own
 * shelf is brought in line with it: written back to the shared one, an event handled late put a stale
 * choice over a newer one and sent it round again (review С-3, adversarial А).
 *
 * **A key gone is not a choice** — every choice is written, «Системная» too. It goes when a full
 * shared shelf refused a choice and lost its past (`writeEverywhere`), or the storage was cleared:
 * read as «Системная», it put every other window in a scheme nobody chose (adversarial Б′). The
 * window keeps its own, which is also what its reload reads — from its own shelf.
 */
export function installColorScheme(): void {
  current.value = storedScheme()
  applyScheme(current.value)
  window.addEventListener('storage', (event) => {
    if (event.key !== SCHEME_KEY || event.newValue === null) return
    const scheme = schemeOf(event.newValue)
    writeOwn(SCHEME_KEY, scheme)
    current.value = scheme
    applyScheme(scheme)
  })
}

export function useColorScheme(): {
  scheme: Readonly<Ref<Scheme>>
  choose: (scheme: Scheme) => void
} {
  /**
   * Applied whether or not it could be kept: storage refused outright, the choice still holds until
   * the page is reloaded, and there is nothing the person could do about it if told.
   */
  function choose(scheme: Scheme): void {
    if (scheme === current.value) return
    keep(scheme)
    current.value = scheme
    applyScheme(scheme)
  }
  return { scheme: readonly(current), choose }
}
