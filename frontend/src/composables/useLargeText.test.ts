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
  // The mixins themselves take none: a module cannot use itself. Plain CSS is read as SCSS, its superset, so its own
  // nesting comes out flat as Sass's does (adversarial Г10); the indented syntax as itself.
  const compiled = (sheet: string, url: URL): string => {
    const indented = url.pathname.endsWith('.sass')
    const mixins = `@use "@/styles/mixins" as *${indented ? '' : ';'}\n`
    return compiler.compileString(url.pathname.endsWith('/_mixins.scss') ? sheet : mixins + sheet, {
      url,
      importers: [fromSrc],
      style: 'compressed',
      syntax: indented ? 'indented' : 'scss',
    }).css
  }

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
  // Fail-closed (adversarial Г4): a rule is the root's unless its subject — the last compound — holds what no root
  // has: a class, an id, a pseudo-element, an element of another name, or a `:is()` whose every selector is such.
  // `*`, `:ROOT`, `:not(body)`, `:has(> body)`, `:scope` and `[data-large-text]` all reach the root without naming it.
  // Strict on purpose: a component's scoped `html` never reaches the root, and still fails here.
  const subjectOf = (selector: string): string => outside(selector.trim(), /[\s>+~]/).at(-1) ?? ''
  // A compound's own text, and each of its functional pseudo-classes with the list in its brackets, however deep
  // (adversarial Г5): `:is(.a, :is(:is(:root)))` gives its `.a` to no one but the `:is()` it stands in.
  const parted = (compound: string): { bare: string; calls: { name: string; list: string }[] } => {
    const calls: { name: string; list: string }[] = []
    let bare = compound
    for (let call = /:([-\w]+)\(/.exec(bare); call; call = /:([-\w]+)\(/.exec(bare)) {
      const start = call.index + call[0].length
      let end = start
      for (let depth = 1; depth > 0 && end < bare.length; end++)
        depth += Number(bare[end] === '(') - Number(bare[end] === ')')
      calls.push({ name: (call[1] ?? '').toLowerCase(), list: bare.slice(start, end - 1) })
      bare = bare.slice(0, call.index) + bare.slice(end)
    }
    return { bare: bare.replace(/\[[^\]]*\]/g, ''), calls }
  }
  const neverRoot = (compound: string): boolean => {
    const { bare, calls } = parted(compound)
    if (/(^|[^-\w.#:])html(?![-\w])|:root(?![-\w])/i.test(bare)) return false
    return (
      /[.#][-\w]|::|^[a-z]/i.test(bare) ||
      calls.some(
        ({ name, list }) =>
          /^(is|where|deep|global|slotted)$/.test(name) &&
          outside(list, /,/).every((one) => neverRoot(subjectOf(one))),
      )
    )
  }
  // Every block's own declarations, up to its first nested block, under each of its selectors.
  // What brackets and braces stand in no count of them (adversarial Г6): a string emptied, an escape and a loud
  // comment taken out — `:is(.b[data-x="("], [lang])` read the rest of the rule as the inside of its `:is(`.
  const plain = (css: string): string =>
    css.replace(
      /\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\[0-9a-f]{1,6}\s?|\\./gi,
      (found) => (found.startsWith('/*') ? '' : /^["']/.test(found) ? '""' : '_'),
    )
  const setsRoot = (css: string): boolean =>
    [...plain(css).matchAll(/([^{};]*)\{(?=([^{}]*))/g)].some(
      ([, selectors = '', declarations = '']) =>
        /(^|;)\s*font(-size)?\s*:/.test(declarations) &&
        outside(selectors, /,/).some((one) => !neverRoot(subjectOf(one))),
    )
  const main = at('../styles/main.scss')
  // The page's root's own `style`, its value quoted or not, as HTML allows (adversarial Г10).
  const rootStyleOf = (html: string): string => {
    const root = /<html\b[^>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html)
    return root?.[1] ?? root?.[2] ?? root?.[3] ?? ''
  }

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

  it('is found in the indented syntax, in plain CSS nesting and in the root’s own style', () => {
    const sass = at('../styles/_reset.sass')
    expect(
      setsRoot(compiled('@media (width >= 40rem)\n  html\n    font-size: 112.5%\n', sass)),
    ).toBe(true)
    const nested = 'html { &[data-outdated] { color: var(--text); } font-size: 100%; }'
    expect(setsRoot(compiled(nested, at('../../public/before.css')))).toBe(true)
    expect(rootStyleOf('<html lang="ru" style=font-size:100%>')).toBe('font-size:100%')
    expect(rootStyleOf('<html lang="ru" style="font-size: 100%">')).toBe('font-size: 100%')
    expect(rootStyleOf('<html lang="ru" data-style="x">')).toBe('')
  })

  it('is found in a plain sheet read as it stands, comments and all', () => {
    expect(setsRoot('/* A reset. */\nhtml {\n  font-size: 62.5%;\n}\n')).toBe(true)
    expect(setsRoot('/* html { font-size: 62.5% } */\nbody {\n  font-size: 1rem;\n}\n')).toBe(false)
  })

  it('is never overridden: no stylesheet sets the root’s font-size', () => {
    // Every sheet the page can be given, whatever way it comes (adversarial Г7, Г9, Г10): of `src` and of `public/`,
    // by every name Vite takes as a sheet, a partial too — a script may import one — and the page's own `<style>` and
    // its root's `style`, quoted or not. `100%` there is no exception: Chrome takes the system's size only from a root
    // nothing sizes.
    const sheetsOf = (dir: URL): URL[] =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .filter((path) => /\.(vue|css|scss|sass|pcss|postcss|sss|less|styl|stylus)$/.test(path))
        .map((path) => new URL(path, dir))
    const entries = [...sheetsOf(src), ...sheetsOf(at('../../public/'))]
    expect(entries.length).toBeGreaterThan(50)
    // A sheet nothing here reads: the build has no preprocessor for it, and the guard no parser.
    const unread = (file: URL): boolean => /\.(sss|less|styl|stylus)$/.test(file.pathname)
    expect(entries.filter(unread).map((file) => file.pathname)).toEqual([])
    const styles = (text: string): string[] =>
      [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(([, style = '']) => style)
    const setIn = (file: URL): boolean => {
      const text = read(file)
      return (file.pathname.endsWith('.vue') ? styles(text) : [text]).some((sheet) =>
        setsRoot(compiled(sheet, file)),
      )
    }
    expect(entries.filter(setIn).map((file) => file.pathname)).toEqual([])
    const page = at('../../index.html')
    const html = read(page)
    expect(
      [...styles(html), `html{${rootStyleOf(html)}}`].filter((sheet) =>
        setsRoot(compiled(sheet, page)),
      ),
    ).toEqual([])
  }, 60_000)
})
