import { readonly, ref } from 'vue'
import type { Ref } from 'vue'
import { forget, read, write } from '@/stores/storage'

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

/** «Системная» is no key at all; anything else under it — an old or foreign value — is too. */
function schemeOf(value: string | null): Scheme {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function storedScheme(): Scheme {
  return schemeOf(read(SCHEME_KEY))
}

/**
 * `write` puts the choice on both shelves, so a window's own shelf has to be brought in line with
 * what another window chose — or its old choice is read back at the next reload.
 */
function keep(scheme: Scheme): void {
  if (scheme === 'system') forget(SCHEME_KEY)
  else write(SCHEME_KEY, scheme)
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
 * but the one that wrote, and a cleared storage arrives with no key at all. The value is taken from
 * the event — the shared shelf's — and kept on this window's own shelf too.
 */
export function installColorScheme(): void {
  current.value = storedScheme()
  applyScheme(current.value)
  window.addEventListener('storage', (event) => {
    if (event.key !== SCHEME_KEY && event.key !== null) return
    const scheme = event.key === null ? 'system' : schemeOf(event.newValue)
    keep(scheme)
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
