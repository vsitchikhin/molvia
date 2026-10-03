// An icon's size is its font-size, a step of --icon-* (Ф-9, MOL-173). The row chevron stood in five
// sizes, 18 to 26, and 24 had come in through `--space-6` in 23 places: width and height pass every
// other rule, so a size typed there was checked by nothing. Here an icon takes `@include icon` — 1em
// both ways — and its step as `font-size`, which the allowed-list holds to `var(--icon*)`.
//
// On a rule that styles an icon, width, height and their logical and min-/max- forms are refused
// unless 1em. A rule styles an icon when the last compound of a selector
//   - is or holds `svg` — `svg`, `.strip svg`, `:deep(svg)`;
//   - holds a class the same SFC puts on an icon in its template, statically: `class="…"` on an
//     `<Icon…>` tag (unplugin-icons) or on a self-closing `<component :is>` — a dynamic component
//     that draws nothing inside is an icon here (TabBar, MoneyEntries, ScreenState…);
//   - or is `&…` nested in such a rule.
// Out of its sight: a class bound by `:class`, and an icon styled from another file — the scoped
// `svg {}` of a parent covers the second, and the first is not used for a size.

import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/icon-size'

const SIZE = /^(min-|max-)?(width|height|inline-size|block-size)$/

const messages = ruleMessages(ruleName, {
  rejected: (prop, value) =>
    `${prop}: ${value} on an icon. An icon is @include icon (1em) with its step as font-size: ` +
    `var(--icon-*) (DESIGN.md, MOL-173).`,
})

const TAG = /<(Icon[A-Z][\w]*|component)\b([^>]*?)(\/?)>/g
const STATIC_CLASS = /(?:^|\s)class="([^"]*)"/

// The classes put on an icon in the template of the SFC this style belongs to.
export function iconClasses(sfc) {
  const template = sfc.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? ''
  const classes = new Set()
  for (const [, tag, attributes, selfClosing] of template.matchAll(TAG)) {
    if (tag === 'component' && !(selfClosing && /\s:is="/.test(attributes))) continue
    const value = attributes.match(STATIC_CLASS)?.[1] ?? ''
    for (const name of value.split(/\s+/)) if (name) classes.add(name)
  }
  return classes
}

// The last compound of a selector, `:deep(…)` opened: what the rule finally styles.
function lastCompound(selector) {
  const opened = selector.replace(/:(deep|global|slotted)\(([^)]*)\)/g, ' $2')
  const parts = opened.trim().split(/\s*[\s>+~]\s*/)
  return parts[parts.length - 1] ?? ''
}

function styles(compound, classes) {
  if (/(^|[^\w-])svg($|[^\w-])/.test(compound)) return true
  for (const [, name] of compound.matchAll(/\.([\w-]+)/g)) if (classes.has(name)) return true
  return false
}

function isIconRule(rule, classes) {
  return rule.selectors.some((selector) => {
    const compound = lastCompound(selector)
    if (styles(compound, classes)) return true
    if (!compound.startsWith('&')) return false
    let parent = rule.parent
    while (parent && parent.type !== 'rule') parent = parent.parent
    return parent ? isIconRule(parent, classes) : false
  })
}

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    // A style block of an SFC is its own root; the document around it holds the template.
    const classes = iconClasses((root.document ?? root).source?.input.css ?? '')

    root.walkRules((node) => {
      if (!isIconRule(node, classes)) return
      for (const decl of node.nodes ?? []) {
        if (decl.type !== 'decl' || !SIZE.test(decl.prop) || decl.value.trim() === '1em') continue
        report({
          ruleName,
          result,
          node: decl,
          message: messages.rejected(decl.prop, decl.value),
          word: decl.prop,
        })
      }
    })
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
