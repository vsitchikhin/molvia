/**
 * Whether a stylesheet sets the root's `font-size` (MOL-334, owner's В-1 «а»): Chrome takes the system's font size
 * as 1rem only from a root nothing sizes. One reader of CSS as Sass writes it or as the browser holds it, for two
 * guards: `useLargeText.test.ts` over every sheet of the module, and `e2e/large-text.spec.ts` over what the build
 * made and what reached the page, wherever it came from (adversarial Г13).
 */

// Split where no bracket is open: a list of selectors at its commas, a selector at its combinators.
function outside(text: string, separator: RegExp): string[] {
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
// `*`, `:ROOT`, `:not(body)`, `:has(> body)`, `:scope`, `&` and `[data-large-text]` all reach the root without
// naming it. Strict on purpose: a component's scoped `html` never reaches the root, and still fails here.
const subjectOf = (selector: string): string => outside(selector.trim(), /[\s>+~]/).at(-1) ?? ''

// A compound's own text, and each of its functional pseudo-classes with the list in its brackets, however deep
// (adversarial Г5): `:is(.a, :is(:is(:root)))` gives its `.a` to no one but the `:is()` it stands in.
function parted(compound: string): { bare: string; calls: { name: string; list: string }[] } {
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

function neverRoot(compound: string): boolean {
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

// What brackets and braces stand in no count of them (adversarial Г6): a string emptied, an escape and a loud
// comment taken out — `:is(.b[data-x="("], [lang])` read the rest of the rule as the inside of its `:is(`.
const plain = (css: string): string =>
  css.replace(
    /\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\[0-9a-f]{1,6}\s?|\\./gi,
    (found) => (found.startsWith('/*') ? '' : /^["']/.test(found) ? '""' : '_'),
  )

/**
 * Every block's own declarations, up to its first nested block, under each of its selectors — whatever condition
 * the block stands under, since a media query or a state the page is not in now is one it may be in later.
 */
export const setsRoot = (css: string): boolean =>
  [...plain(css).matchAll(/([^{};]*)\{(?=([^{}]*))/g)].some(
    ([, selectors = '', declarations = '']) =>
      /(^|;)\s*font(-size)?\s*:/.test(declarations) &&
      outside(selectors, /,/).some((one) => !neverRoot(subjectOf(one))),
  )
