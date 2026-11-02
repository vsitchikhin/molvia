import { readFileSync, readdirSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useLargeText } from '@/composables/useLargeText'

describe('useLargeText (MOL-321)', () => {
  let rem = 16
  let resized: (() => void) | null = null

  function host() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width: rem }) as DOMRect,
    )
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback
        }
        observe(): void {
          // The test calls `resized` itself, as the browser would on a new size of the rem.
        }
        disconnect(): void {
          resized = null
        }
      },
    )
    return mount(defineComponent({ setup: () => (useLargeText(), () => h('div')) }))
  }

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    rem = 16
  })

  it('must not fire at the browser’s own size, nor a step under large', () => {
    rem = 17.6
    const view = host()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(false)
    view.unmount()
  })

  it('marks the root once the rem grows, and lets go when it shrinks back', () => {
    rem = 24
    const view = host()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(true)
    rem = 16
    resized?.()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(false)
    rem = 18
    resized?.()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(true)
    view.unmount()
    expect(document.documentElement.hasAttribute('data-large-text')).toBe(false)
  })
})

/**
 * The system's font size is the root's (MOL-334, owner's В-1 «а»): `<meta name="text-scale">` makes Chrome set
 * 1rem by it — the very model `useLargeText` and every spec read — and Chrome takes it only while no stylesheet
 * sets the root's `font-size` itself.
 */
describe('the system’s font size (MOL-334)', () => {
  // Through a parameter: a literal `new URL(…, import.meta.url)` is rewritten by Vite into an asset URL.
  const at = (path: string): URL => new URL(path, import.meta.url)
  const read = (path: URL): string => readFileSync(path, 'utf8')
  const src = at('../')

  it('is asked of the browser in the page’s head', () => {
    const html = read(at('../../index.html'))
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toMatch(/<meta\s+name="text-scale"\s+content="scale"\s*\/?>/)
  })

  it('is never overridden: no stylesheet sets the root’s font-size', () => {
    const sheets = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((path) =>
      /\.(scss|vue)$/.test(path),
    )
    expect(sheets.length).toBeGreaterThan(50)
    // Every rule's own declarations — up to its first nested rule — under a list of selectors one of which is the
    // root itself: `html, body { … }` counts, `html[data-large-text] body` is the body's and `html { .x { … } }` the
    // nested rule's.
    const setsRoot = (sheet: string): boolean =>
      [...sheet.matchAll(/([^{};]*)\{([^{}]*)/g)].some(
        ([, selectors = '', declarations = '']) =>
          /\bfont-size\s*:/.test(declarations) &&
          selectors.split(',').some((one) => /^\s*(?:html|:root)(?:[[:.][^\s>+~]*)?\s*$/.test(one)),
      )
    const offenders = sheets.filter((path) => setsRoot(read(new URL(path, src))))
    expect(offenders).toEqual([])
  })
})
