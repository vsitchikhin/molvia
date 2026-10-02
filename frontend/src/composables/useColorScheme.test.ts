import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SCHEME_KEY,
  applyScheme,
  installColorScheme,
  storedScheme,
  useColorScheme,
} from '@/composables/useColorScheme'

// Through a parameter: a literal `new URL(…, import.meta.url)` is rewritten by Vite into an asset URL.
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const html = read('../../index.html')
const themeColors = [...html.matchAll(/<meta\s+name="theme-color"[\s\S]*?\/>/g)].map(([tag]) => tag)
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => body ?? '')
const prePaint = scripts.filter((body) => body.includes(SCHEME_KEY))

/** The script as the browser runs it: in the head, over the page's own theme colours. */
function runPrePaint(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own script, as the browser runs it
  new Function(prePaint[0] ?? '')()
}

function media(scheme: 'light' | 'dark'): string | null {
  return (
    document
      .querySelector(`meta[name="theme-color"][data-scheme-of="${scheme}"]`)
      ?.getAttribute('media') ?? null
  )
}

const SYSTEM = { light: '(prefers-color-scheme: light)', dark: '(prefers-color-scheme: dark)' }

beforeEach(() => {
  // The module's choice outlives a test; the system is where every test starts — chosen first, as
  // choosing writes it, and then the shelves emptied.
  useColorScheme().choose('system')
  localStorage.clear()
  sessionStorage.clear()
  delete document.documentElement.dataset.scheme
  document.head.innerHTML = themeColors.join('')
})

/**
 * Replaces a method of a storage for one test. Put back by defining the original again, as
 * `storage.test.ts` does: happy-dom keeps the spy of `vi.spyOn` on the storage after a restore.
 */
const replaced: (() => void)[] = []
function stub(shelf: Storage, name: 'getItem' | 'setItem' | 'removeItem', value: unknown): void {
  const original = shelf[name].bind(shelf)
  Object.defineProperty(shelf, name, { configurable: true, writable: true, value })
  replaced.push(() => {
    Object.defineProperty(shelf, name, { configurable: true, writable: true, value: original })
  })
}

afterEach(() => {
  for (const restore of replaced.splice(0)) restore()
})

describe('the script that sets the scheme before the first paint', () => {
  it('is one, and reads the key the module keeps', () => {
    expect(prePaint).toHaveLength(1)
    expect(themeColors).toHaveLength(2)
  })

  it.each([
    ['light', localStorage],
    ['dark', localStorage],
    ['light', sessionStorage],
    ['dark', sessionStorage],
  ] as const)('draws %s from either shelf, the status bar with it', (scheme, shelf) => {
    shelf.setItem(SCHEME_KEY, scheme)
    runPrePaint()
    expect(document.documentElement.dataset.scheme).toBe(scheme)
    expect(media(scheme)).toBe('all')
    expect(media(scheme === 'light' ? 'dark' : 'light')).toBe('not all')
  })

  it('leaves the system alone with nothing stored, or with anything but a scheme', () => {
    for (const value of [null, '', 'blue', 'system', 'DARK']) {
      localStorage.clear()
      if (value !== null) localStorage.setItem(SCHEME_KEY, value)
      runPrePaint()
      expect(document.documentElement.dataset.scheme).toBeUndefined()
      expect(media('light')).toBe(SYSTEM.light)
      expect(media('dark')).toBe(SYSTEM.dark)
    }
  })

  it('answers what the module answers, for every pair of shelves', () => {
    const values = [null, 'light', 'dark', 'system', 'blue']
    for (const shared of values) {
      for (const own of values) {
        localStorage.clear()
        sessionStorage.clear()
        delete document.documentElement.dataset.scheme
        if (shared !== null) localStorage.setItem(SCHEME_KEY, shared)
        if (own !== null) sessionStorage.setItem(SCHEME_KEY, own)
        runPrePaint()
        const drawn = document.documentElement.getAttribute('data-scheme') ?? 'system'
        expect(drawn, `shared ${String(shared)}, own ${String(own)}`).toBe(storedScheme())
      }
    }
  })

  it('stands a storage that throws on every read', () => {
    stub(localStorage, 'getItem', () => {
      throw new Error('SecurityError')
    })
    sessionStorage.setItem(SCHEME_KEY, 'dark')
    expect(runPrePaint).not.toThrow()
    expect(document.documentElement.dataset.scheme).toBe('dark')
  })
})

describe('applyScheme', () => {
  it('points both theme colours back at the system for «Системная»', () => {
    applyScheme('dark')
    applyScheme('system')
    expect(document.documentElement.dataset.scheme).toBeUndefined()
    expect(media('light')).toBe(SYSTEM.light)
    expect(media('dark')).toBe(SYSTEM.dark)
  })

  it('keeps the colours where they are: only media moves', () => {
    const before = themeColors.map((tag) => /content="([^"]+)"/.exec(tag)?.[1])
    applyScheme('light')
    const after = [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
      meta.getAttribute('content'),
    )
    expect(after).toEqual(before)
  })
})

describe('useColorScheme', () => {
  it('keeps a chosen scheme on the device and draws it at once', () => {
    const { scheme, choose } = useColorScheme()
    choose('dark')
    expect(scheme.value).toBe('dark')
    expect(localStorage.getItem(SCHEME_KEY)).toBe('dark')
    expect(document.documentElement.dataset.scheme).toBe('dark')
    expect(media('dark')).toBe('all')
    expect(media('light')).toBe('not all')
  })

  it('«Системная» is written too, on both shelves, and draws the system', () => {
    const { choose } = useColorScheme()
    choose('light')
    choose('system')
    expect(localStorage.getItem(SCHEME_KEY)).toBe('system')
    expect(sessionStorage.getItem(SCHEME_KEY)).toBe('system')
    expect(document.documentElement.dataset.scheme).toBeUndefined()
  })

  // Adversarial Б: `write` was content with the tab's shelf, and the shared one, read first, kept
  // the choice the person had left — and answered it after a reload.
  it('a choice the shared shelf refused does not give way to its past after a reload', () => {
    useColorScheme().choose('light')
    stub(localStorage, 'setItem', () => {
      throw new Error('QuotaExceededError')
    })
    useColorScheme().choose('dark')
    expect(localStorage.getItem(SCHEME_KEY)).toBeNull()
    expect(storedScheme()).toBe('dark')
    delete document.documentElement.dataset.scheme
    runPrePaint()
    expect(document.documentElement.dataset.scheme).toBe('dark')
  })

  it('writes nothing for the scheme already chosen', () => {
    const { choose } = useColorScheme()
    choose('light')
    const set = vi.fn()
    const remove = vi.fn()
    stub(localStorage, 'setItem', set)
    stub(localStorage, 'removeItem', remove)
    choose('light')
    expect(set).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('still draws a choice no shelf would keep', () => {
    stub(localStorage, 'setItem', () => {
      throw new Error('QuotaExceededError')
    })
    stub(sessionStorage, 'setItem', () => {
      throw new Error('QuotaExceededError')
    })
    const { scheme, choose } = useColorScheme()
    expect(() => {
      choose('dark')
    }).not.toThrow()
    expect(scheme.value).toBe('dark')
    expect(document.documentElement.dataset.scheme).toBe('dark')
  })
})

describe('installColorScheme', () => {
  function heard(key: string | null, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
  }

  it('takes the stored choice', () => {
    localStorage.setItem(SCHEME_KEY, 'dark')
    installColorScheme()
    expect(useColorScheme().scheme.value).toBe('dark')
    expect(document.documentElement.dataset.scheme).toBe('dark')
  })

  it('follows another window, and brings only this window’s own shelf in line', () => {
    useColorScheme().choose('dark')
    installColorScheme()
    // Another window chose light: the shared shelf says so, this tab's still says dark.
    localStorage.setItem(SCHEME_KEY, 'light')
    // Review С-3: the shared shelf is not written back — an event handled late would put its stale
    // value over a newer one and send it round again.
    const shared = vi.fn()
    stub(localStorage, 'setItem', shared)
    heard(SCHEME_KEY, 'light')
    expect(useColorScheme().scheme.value).toBe('light')
    expect(document.documentElement.dataset.scheme).toBe('light')
    expect(sessionStorage.getItem(SCHEME_KEY)).toBe('light')
    expect(shared).not.toHaveBeenCalled()
  })

  it('goes back to the system when another window chose it, and the reload agrees', () => {
    useColorScheme().choose('dark')
    installColorScheme()
    localStorage.setItem(SCHEME_KEY, 'system')
    heard(SCHEME_KEY, 'system')
    expect(document.documentElement.dataset.scheme).toBeUndefined()
    expect(sessionStorage.getItem(SCHEME_KEY)).toBe('system')
    expect(storedScheme()).toBe('system')
  })

  // Adversarial В: «Системная» was a removed key, and a tab that missed it — unloaded, closed and
  // brought back — read its own «Тёмная» from under the empty shared shelf at every reload.
  it('a tab that never heard «Системная» still comes back to it', () => {
    sessionStorage.setItem(SCHEME_KEY, 'dark')
    localStorage.setItem(SCHEME_KEY, 'system')
    installColorScheme()
    expect(useColorScheme().scheme.value).toBe('system')
    runPrePaint()
    expect(document.documentElement.dataset.scheme).toBeUndefined()
  })

  it('takes a key removed elsewhere for the system', () => {
    useColorScheme().choose('dark')
    installColorScheme()
    localStorage.removeItem(SCHEME_KEY)
    heard(SCHEME_KEY, null)
    expect(useColorScheme().scheme.value).toBe('system')
    expect(storedScheme()).toBe('system')
  })

  it('takes a storage cleared elsewhere for the system', () => {
    useColorScheme().choose('light')
    installColorScheme()
    localStorage.clear()
    heard(null, null)
    expect(useColorScheme().scheme.value).toBe('system')
    expect(storedScheme()).toBe('system')
  })

  it('does not hear another key', () => {
    useColorScheme().choose('dark')
    installColorScheme()
    heard('molvia.keyboard', '{}')
    expect(document.documentElement.dataset.scheme).toBe('dark')
  })
})
