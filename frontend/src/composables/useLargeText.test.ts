import { readFileSync, readdirSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { initCompiler } from 'sass-embedded'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { setsRoot, zooms } from '@molvia/frontend/testing/root-font-size'
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

  // Read as Sass writes it, not as typed (adversarial Г3): comments, `@media`, a mixin and nesting are gone by then,
  // so `html { &[data-large-text] { … } }` is the root's rule it becomes. The mixins are put in as Vite puts them.
  const compiler = initCompiler()
  afterAll(() => {
    compiler.dispose()
  })
  const fromSrc = {
    findFileUrl: (url: string) => (url.startsWith('@/') ? at(`../${url.slice(2)}`) : null),
  }
  // The mixins themselves take none: a module cannot use itself.
  const compiled = (scss: string, url: URL): string =>
    compiler.compileString(
      url.pathname.endsWith('/_mixins.scss') ? scss : `@use "@/styles/mixins" as *;\n${scss}`,
      { url, importers: [fromSrc], style: 'compressed' },
    ).css

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
    ['by any element', '* { font-size: var(--text-body); }'],
    ['in capitals', ':ROOT { font-size: var(--text-body); }'],
    ['by what it is not', ':not(body) { font-size: var(--text-body); }'],
    ['by what it holds', ':has(> body) { font-size: var(--text-body); }'],
    ['as a scope', '@scope (html) { :scope { font-size: var(--text-body); } }'],
    ['by its attribute alone', '[data-large-text] { font-size: var(--text-body); }'],
    ['under a class nested deep', ':is(.a, :is(:is(:root))) { font-size: var(--text-body); }'],
    [
      'under a :not() nested deep',
      ':not(:is(.x, :is(:is(body)))) { font-size: var(--text-body); }',
    ],
    ['past a bracket in a string', ':is(.b[data-x="("], [lang]) { font-size: var(--text-body); }'],
    ['past a loud comment', '/*! ( */ :root { font-size: var(--text-body); }'],
    ['even at its own 100 %', 'html { font-size: 100%; }'],
  ])('is found setting the root %s', (_, scss) => {
    expect(setsRoot(compiled(scss, main))).toBe(true)
  })

  it.each([
    ['the body under the root', 'html[data-large-text] body { font-size: var(--text-body); }'],
    ['a unit by the word-unit mixin', '.x { @include word-unit; font-size: var(--text-body); }'],
    ['anything but the root', ':where(body:not(html)) { font-size: var(--text-body); }'],
    ['the root’s other properties', 'html { font-family: var(--font); }'],
    ['a class that is not the root', '.x:not(html) { font-size: var(--text-body); }'],
    ['a list of classes', ':is(.a, .b) { font-size: var(--text-body); }'],
    ['a pseudo-element', 'p::before { font-size: var(--text-body); }'],
    ['a deep class', '.a :deep(.b) { font-size: var(--text-body); }'],
    ['classes nested deep', ':is(.a, :is(:is(.b))) { font-size: var(--text-body); }'],
    ['a brace in its content', '.x::before { content: "{"; font-size: var(--text-body); }'],
    ['a class with an escaped bracket', '.a\\(b { font-size: var(--text-body); }'],
  ])('must not fire on %s', (_, scss) => {
    expect(setsRoot(compiled(scss, main))).toBe(false)
  })

  it('reads past comments as typed', () => {
    expect(setsRoot('/* A reset. */\nhtml {\n  font-size: 62.5%;\n}\n')).toBe(true)
    expect(setsRoot('/* html { font-size: 62.5% } */\nbody {\n  font-size: 1rem;\n}\n')).toBe(false)
  })

  it('reads a block’s declarations after a block nested in it, as the browser holds plain CSS (adversarial Г14)', () => {
    expect(setsRoot('html {\n  & .x { color: red; }\n  font-size: 62.5%;\n}')).toBe(true)
    expect(setsRoot('.a {\n  & .x { color: red; }\n  font-size: 62.5%;\n}')).toBe(false)
  })

  it.each([
    ['on the app, under a media query', '@media (orientation: landscape) { #app { zoom: 0.5; } }'],
    ['by a custom property', '.x { zoom: var(--z); }'],
    ['by a share', 'html[data-large-text] .a { zoom: 50%; }'],
  ])('finds a zoom %s (adversarial Г15)', (_, scss) => {
    expect(zooms(compiled(scss, main))).toBe(true)
  })

  it('must not fire on a zoom that changes nothing, or on a word with zoom in it', () => {
    expect(
      zooms(compiled('.a { zoom: 1; }\n.b { zoom: normal; }\n.c { zoom: reset; }', main)),
    ).toBe(false)
    expect(zooms(compiled('.a { --zoom: 0.5; }\n.b::before { content: "zoom: 0.5"; }', main))).toBe(
      false,
    )
  })

  it('is never overridden: no stylesheet sets the root’s font-size', () => {
    // Everything is SCSS (CLAUDE.md), and the guard reads it with the very Sass that builds it — of the whole module,
    // partials too, since a script may import one: Vite takes `/reset.scss` and `@/../reset.scss` from beside `src`
    // (adversarial Г12), so only what npm and the builds put there is left out. Read as Sass, a plain sheet hid
    // `//{}html{…}` the browser applies; read as it stands, its nesting (Г10, Г11): no reading is right for two
    // languages, so any other sheet by a name Vite takes is simply not there. `100%` is no exception: Chrome takes the
    // system's size only from a root nothing sizes.
    const sheet = /\.(vue|css|scss|sass|pcss|postcss|sss|less|styl|stylus)$/
    const sheetsOf = (dir: URL): URL[] =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((path) => sheet.test(path))
        .map((path) => new URL(path, dir))
    const frontend = at('../../')
    const entries = readdirSync(frontend, { withFileTypes: true })
      .filter((entry) => !/^(node_modules|dist|dist-e2e|dev-dist|coverage)$/.test(entry.name))
      .flatMap((entry) =>
        entry.isDirectory()
          ? sheetsOf(new URL(`${entry.name}/`, frontend))
          : sheet.test(entry.name)
            ? [new URL(entry.name, frontend)]
            : [],
      )
    expect(entries.length).toBeGreaterThan(50)
    const scss = (file: URL): boolean => /\.(vue|scss)$/.test(file.pathname)
    expect(entries.filter((file) => !scss(file)).map((file) => file.pathname)).toEqual([])
    const styles = (text: string): string[] =>
      [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, style = '']) => style)
    const css = (file: URL): string => {
      const text = read(file)
      return (file.pathname.endsWith('.vue') ? styles(text) : [text])
        .map((sheet) => compiled(sheet, file))
        .join('')
    }
    const sheets = entries.map((file) => ({ path: file.pathname, css: css(file) }))
    expect(
      sheets.filter((sheet) => setsRoot(sheet.css) || zooms(sheet.css)).map((sheet) => sheet.path),
    ).toEqual([])
    // A sheet by an address, `data:` too, is one the guard never reads (Г11).
    expect(sheets.filter((sheet) => /@import/i.test(sheet.css)).map((sheet) => sheet.path)).toEqual(
      [],
    )
    // Nor is the page's own: no `<style>`, no sheet by a `<link>`, no `style` on its root, however it is spelled.
    const page = read(at('../../index.html'))
    expect(page).not.toMatch(/<style\b/i)
    expect(page).not.toMatch(/<link\b[^>]*stylesheet/i)
    expect(page).not.toMatch(/<html\b[^>]*style\s*=/i)
  }, 60_000)
})
