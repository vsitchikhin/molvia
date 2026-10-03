// An icon's size is a step of --icon-* (Ф-9, MOL-173). The row chevron stood in five sizes, 18 to 26,
// and 24 had come in through `--space-6` in 23 places: width and height pass every other rule, so a
// size typed there was checked by nothing. An icon is `@include icon` — 1em both ways — with its step
// written beside it as `font-size`.
//
// What the rule holds, on an icon:
//   - an icon worn with a class in the template has both, `@include icon` and a step, in the rules of
//     its classes (adversarial А1: a step alone draws the 1.2em unplugin-icons sets, 24 for a chevron
//     of 20; the mixin alone draws the text around it); a rule on `svg` has both — the step in itself
//     or in a rule around it (AppButton's glyph) — or neither, and then only colours an icon;
//   - `font-size` only `var(--icon*)` or `var(--state-glyph)` — a step of text, 1em or inherit is the
//     text's size, not the icon's;
//   - width, height, their logical and min-/max- forms only 1em; no padding (the old pencil was a box
//     of 32 with a glyph of 16, А4), no scale; no `@include` but `icon` (a mixin of its own carried a
//     width past the rule, А6) — and all of it inside a nested `@media` or `@include … { }` too (А2);
//   - in the template, no width or height in `style`, `:style` or as an attribute of the icon (А5).
//
// A rule styles an icon when, its nesting resolved (`&`, `&-suffix`), the last compound of a selector
// is the tag `svg` (`:deep(svg)` opened, `:is()`/`:where()` read inside) or holds a class the same SFC
// puts on an icon in its template, statically. An icon is a tag imported from `~icons/` under any name
// (or written `Icon…`, `icon-…`), and a `<component :is>` that holds nothing.
// Out of its sight: a class bound by `:class`, and an icon styled from another file — the scoped
// `svg {}` of a parent covers the second, and the first is not used for a size.

import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/icon-size'

const SIZE = /^(min-|max-)?(width|height|inline-size|block-size)$/
const PADDING = /^padding(-|$)/
const STEP = /^var\(--(icon(-[a-z0-9]+)*|state-glyph)\)$/

const messages = ruleMessages(ruleName, {
  size: (prop, value) =>
    `${prop}: ${value} on an icon. An icon is @include icon (1em) with its step as font-size: ` +
    `var(--icon-*) (DESIGN.md, MOL-173).`,
  step: (value) =>
    `font-size: ${value} on an icon. Its size is a step of the icon scale: var(--icon-*) or ` +
    `var(--state-glyph) (MOL-173).`,
  include: (name) =>
    `@include ${name} on an icon. An icon takes @include icon alone; a size brought by another mixin ` +
    `passes no check (MOL-173).`,
  missing: (what, where) =>
    `${where} has no ${what}. An icon is @include icon with its step as font-size: var(--icon-*) ` +
    `(MOL-173).`,
  template: (what, line) =>
    `${what} on an icon in the template (line ${line}). Its size is the font-size of its class, a ` +
    `step of --icon-* (MOL-173).`,
})

// --- the template -------------------------------------------------------------------------------

// The attributes' quotes kept: a `>` inside them ends no tag (А3).
const TAG = /<([A-Za-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const CLASS = /(?:^|\s)class=(?:"([^"]*)"|'([^']*)')/
const SIZE_ATTRIBUTE = /(?:^|\s)(?::|v-bind:)?(width|height)=/
const STYLE_SIZE =
  /(?:^|\s)(?::|v-bind:)style=(?:"[^"]*\b(?:width|height|scale|padding)\b[^"]*"|'[^']*\b(?:width|height|scale|padding)\b[^']*')/
const IMPORT = /import\s+(\w+)\s+from\s+['"]~icons\/[^'"]+['"]/g

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const blank = (text) => text.replace(/[^\n]/g, ' ')

// The icons of an SFC's template: their static classes, the line they stand on, and what they say of
// a size in the template itself.
export function iconTags(sfc) {
  const open = sfc.search(/<template(\s[^>]*)?>/)
  const close = sfc.lastIndexOf('</template>')
  if (open < 0 || close < open) return []
  const imported = new Set()
  for (const [, name] of sfc.matchAll(IMPORT)) imported.add(name).add(kebab(name))
  const template = sfc.slice(0, close).replace(/<!--[\s\S]*?-->/g, blank)
  const tags = []
  TAG.lastIndex = open
  for (let m = TAG.exec(template); m; m = TAG.exec(template)) {
    const [whole, name, attributes, selfClosing] = m
    const icon =
      imported.has(name) ||
      /^Icon[A-Z]/.test(name) ||
      /^icon-/.test(name) ||
      (name === 'component' &&
        /\s(:|v-bind:)is=/.test(attributes) &&
        (selfClosing !== '' || /^\s*<\/component>/.test(template.slice(m.index + whole.length))))
    if (!icon) continue
    const quoted = attributes.match(CLASS)
    const value = quoted?.[1] ?? quoted?.[2] ?? ''
    tags.push({
      classes: value.split(/\s+/).filter(Boolean),
      line: sfc.slice(0, m.index).split('\n').length,
      sizeAttribute: attributes.match(SIZE_ATTRIBUTE)?.[1],
      styleSize: STYLE_SIZE.test(attributes),
    })
  }
  return tags
}

// --- selectors ----------------------------------------------------------------------------------

// The parts of a selector between the characters `at` matches, outside parentheses.
function split(selector, at) {
  const parts = []
  let depth = 0
  let part = ''
  for (const char of selector) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth === 0 && at.test(char)) {
      if (part.trim()) parts.push(part.trim())
      part = ''
      continue
    }
    part += char
  }
  if (part.trim()) parts.push(part.trim())
  return parts
}

const ruleAround = (node) => {
  let parent = node.parent
  while (parent && parent.type !== 'rule') parent = parent.parent
  return parent
}

// A rule's selectors with its nesting resolved: `&` replaced by the selector around it — so `&-chevron`
// is glued to it (А7) — and a selector with no `&` put under it.
function resolved(rule) {
  const own = split(rule.selector, /,/)
  const parent = ruleAround(rule)
  if (!parent) return own
  return resolved(parent).flatMap((outer) =>
    own.map((inner) => (inner.includes('&') ? inner.replaceAll('&', outer) : `${outer} ${inner}`)),
  )
}

// What the last compound of a selector styles: the tag svg, and its classes — `:deep()` opened,
// `:is()` and `:where()` read inside, `:not()` left out.
function target(selector) {
  const opened = selector.replace(/:(deep|global|slotted)\(([^()]*)\)/g, ' $2')
  const compounds = split(opened, /[\s>+~]/)
  const last = (compounds[compounds.length - 1] ?? '').replace(/:not\([^()]*\)/g, '')
  return {
    svg: /(^|[(,]\s*)svg(?![\w-])/.test(last),
    classes: [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
  }
}

// --- the rule -----------------------------------------------------------------------------------

// A rule's declarations and includes, down its at-rules but not into a nested rule, which is checked
// as a rule of its own (А2).
function ownNodes(rule) {
  const nodes = []
  const walk = (node) => {
    for (const child of node.nodes ?? []) {
      if (child.type === 'rule') continue
      nodes.push(child)
      if (child.type === 'atrule') walk(child)
    }
  }
  walk(rule)
  return nodes
}

const mixinOf = (node) => node.params.split(/[\s(]/)[0]
const includes = (node, name) =>
  node.type === 'atrule' && node.name === 'include' && mixinOf(node) === name
const steps = (node) => node.type === 'decl' && node.prop === 'font-size' && STEP.test(node.value)
const resizes = (decl, value) =>
  (SIZE.test(decl.prop) && value !== '1em') ||
  (PADDING.test(decl.prop) && !/^0(\s+0)*$/.test(value)) ||
  (decl.prop === 'scale' && !/^(none|1)$/.test(value)) ||
  (decl.prop === 'transform' && /scale/.test(value))

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const document = root.document ?? root
    const sfc = document.source?.input.css ?? ''
    const tags = iconTags(sfc)
    const classes = new Set(tags.flatMap((tag) => tag.classes))
    const flag = (node, message) => report({ ruleName, result, node, message })

    // A `style="…"` of the template is a root of its own: on an icon it holds no size (А5).
    if (root.source?.inline) {
      const at = root.source.start?.offset ?? 0
      const tag = sfc.slice(sfc.lastIndexOf('<', at) + 1).match(/^[\w-]+/)?.[0] ?? ''
      const probe = `${sfc.match(IMPORT)?.join('\n') ?? ''}\n<template><${tag} /></template>`
      if (iconTags(probe).length === 0) return
      root.walkDecls((decl) => {
        if (resizes(decl, decl.value.trim())) flag(decl, messages.size(decl.prop, decl.value))
      })
      return
    }

    const iconRules = []
    root.walkRules((node) => {
      const targets = resolved(node).map(target)
      if (targets.some((t) => t.svg || t.classes.some((name) => classes.has(name))))
        iconRules.push([node, targets])
    })

    for (const [node, targets] of iconRules) {
      const nodes = ownNodes(node)
      for (const child of nodes) {
        if (child.type === 'atrule' && child.name === 'include' && !includes(child, 'icon'))
          flag(child, messages.include(mixinOf(child)))
        if (child.type !== 'decl') continue
        const value = child.value.trim()
        if (resizes(child, value)) flag(child, messages.size(child.prop, value))
        if (child.prop === 'font-size' && !STEP.test(value)) flag(child, messages.step(value))
      }

      // A rule on svg comes with the pair, or with neither — then it only colours an icon another rule
      // sizes: the mixin with a step in it or in a rule around it, a step with the mixin.
      if (!targets.some((t) => t.svg)) continue
      const where = `«${node.selector}»`
      const mixed = nodes.some((n) => includes(n, 'icon'))
      let stepped = nodes.some(steps)
      if (nodes.some(steps) && !mixed) flag(node, messages.missing('@include icon', where))
      for (let around = ruleAround(node); around && !stepped; around = ruleAround(around))
        stepped = ownNodes(around).some(steps)
      if (mixed && !stepped) flag(node, messages.missing('step as font-size', where))
    }

    // The template is the document's: read once, with its first style block.
    const blocks = root.document
      ? root.document.nodes.filter((node) => node.type === 'root' && !node.source?.inline)
      : [root]
    if (blocks[0] !== root) return

    const all = blocks.flatMap((block) => {
      const rules = []
      block.walkRules((node) => rules.push([node, resolved(node).map(target)]))
      return rules
    })
    const seen = new Set()
    for (const tag of tags) {
      if (tag.sizeAttribute) flag(root, messages.template(`${tag.sizeAttribute}=`, tag.line))
      if (tag.styleSize) flag(root, messages.template('A size in style', tag.line))
      const key = [...tag.classes].sort().join(' ')
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      const wearing = all.filter(([, targets]) =>
        targets.some((t) => t.classes.some((name) => tag.classes.includes(name))),
      )
      const nodes = wearing.flatMap(([node]) => ownNodes(node))
      const anchor = wearing[0]?.[0] ?? root
      const where = `The icon «.${tag.classes.join('.')}» (line ${tag.line})`
      if (!nodes.some((n) => includes(n, 'icon')))
        flag(anchor, messages.missing('@include icon', where))
      if (!nodes.some(steps)) flag(anchor, messages.missing('step as font-size', where))
    }
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
