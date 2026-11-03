import { readFileSync, readdirSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { initCompiler } from 'sass-embedded'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
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

  // Read as Sass writes it, not as typed (adversarial Г3): comments, `@media`, a mixin and nesting are gone by then,
  // so `html { &[data-large-text] { … } }` is the root's rule it becomes. The mixins are put in as Vite puts them.
  const compiler = initCompiler()
  afterAll(() => {
    compiler.dispose()
  })
  const fromSrc = {
    findFileUrl: (url: string) => (url.startsWith('@/') ? at(`../${url.slice(2)}`) : null),
  }
  const compiled = (scss: string, url: URL): string =>
    compiler.compileString(`@use "@/styles/mixins" as *;\n${scss}`, {
      url,
      importers: [fromSrc],
      style: 'compressed',
    }).css

  // Split where no bracket is open: a list of selectors at its commas, a selector at its combinators.
  const outside = (text: string, separator: RegExp): string[] => {
    const parts: string[] = []
    let part = ''
    let depth = 0
    for (const char of text) {
      depth += Number(char === '(' || char === '[') - Number(char === ')' || char === ']')
      if (depth === 0 && separator.test(char)) {
        parts.push(part)
        part = ''
      } else part += char
    }
    return [...parts, part]
  }
  // The subject — the last compound, `:not()` taken out — names the root: `:where(html:not([hidden]))` does,
  // `html[data-large-text] body` is the body's. Strict on purpose: a component's scoped `html` never reaches the root,
  // and still fails here.
  const namesRoot = (selector: string): boolean =>
    /(^|[^-\w])html(?![-\w])|:root\b/.test(
      (outside(selector.trim(), /[\s>+~]/).at(-1) ?? '').replace(
        /:not\((?:[^()]|\([^()]*\))*\)/g,
        '',
      ),
    )
  // Every block's own declarations, up to its first nested block, under each of its selectors.
  const setsRoot = (css: string): boolean =>
    [...css.matchAll(/([^{};]*)\{(?=([^{}]*))/g)].some(
      ([, selectors = '', declarations = '']) =>
        /(^|;)\s*font(-size)?\s*:/.test(declarations) && outside(selectors, /,/).some(namesRoot),
    )
  const main = at('../styles/main.scss')

  it('is asked of the browser in the page’s head', () => {
    const html = read(at('../../index.html'))
    const head = html.slice(0, html.indexOf('</head>'))
    expect(head).toMatch(/<meta\s+name="text-scale"\s+content="scale"\s*\/?>/)
  })

  it.each([
    ['in a media query', '@media (width >= 40rem) { html { font-size: var(--text-callout); } }'],
    [
      'in the project’s own mixin',
      'html { @include wider-than-phone { font-size: var(--text-callout); } }',
    ],
    ['nested under the root', 'html { &[data-large-text] { font-size: var(--text-body); } }'],
    [
      'inside :where() with a :not()',
      ':where(html:not([hidden])) { font-size: var(--text-body); }',
    ],
    ['one of a list, under a comment', '/* why */\n:root,\nbody { font-size: var(--text-body); }'],
    ['by the shorthand', 'html { font: 600 var(--text-body) / 1.4 var(--font); }'],
  ])('is found setting the root %s', (_, scss) => {
    expect(setsRoot(compiled(scss, main))).toBe(true)
  })

  it.each([
    ['the body under the root', 'html[data-large-text] body { font-size: var(--text-body); }'],
    ['a unit by the word-unit mixin', '.x { @include word-unit; font-size: var(--text-body); }'],
    ['anything but the root', ':where(body:not(html)) { font-size: var(--text-body); }'],
    ['the root’s other properties', 'html { font-family: var(--font); }'],
  ])('must not fire on %s', (_, scss) => {
    expect(setsRoot(compiled(scss, main))).toBe(false)
  })

  it('is never overridden: no stylesheet sets the root’s font-size', () => {
    const entries = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((path) =>
      /(^|\/)(?!_)[^/]*\.(scss|vue)$/.test(path),
    )
    expect(entries.length).toBeGreaterThan(50)
    const sheets = (path: string): string[] => {
      const text = read(at(`../${path}`))
      return path.endsWith('.vue')
        ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, style = '']) => style)
        : [text]
    }
    const offenders = entries.filter((path) =>
      sheets(path).some((scss) => setsRoot(compiled(scss, at(`../${path}`)))),
    )
    expect(offenders).toEqual([])
  }, 60_000)
})
