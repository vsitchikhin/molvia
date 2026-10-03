// A display role is whole (MOL-171, Ф-7, owner's В-3): a rule that includes `display-type` sets
// neither the face nor the weight nor the variation axis itself. The allowed-list cannot see this —
// `font-weight: var(--weight-regular)` is a fine value anywhere else — and after the include it
// draws the dram sign at 400 beside figures at 800 (the Dram face has three weights, Nunito one),
// while `font-variation-settings` moves Nunito's own axis, the file being a variable font.
//
// The whole rule is read, down its nested at-rules: an `@media` or `@include wider-than-phone`
// inside it is the same element on a wider screen (adversarial Б2) — and a role set inside one of
// them is checked from the rule up, so a sibling block cannot set the weight again (Ж1). A nested rule is another element
// or a variant, and may set these only together with a face of its own — a sentence in a figure's
// place (`&.missing`) is Onest — `font-family: var(--font)`, never `inherit`, which keeps Nunito (В2);
// a variant that stays in Nunito keeps its one weight (Б1). Another rule for the same element
// elsewhere in the file is beyond what a linter can match (Б3), and so the role is never put in a
// placeholder, where `@extend` would carry it into such a rule (В3).
//
// A mixin that includes the role is the role (В1), through any number of wrappers. It may be written
// in styles/_mixins.scss alone — the one place the plugin reads when it loads, so the place a wrapper
// can live and the place it is looked for are one (Ж2, З1); written anywhere else it is refused. Names are
// compared as Sass compares them — a hyphen and an underscore are one character (Г1) — and found
// however the include names them: through a namespace (`m.display-type`, Д1) or `sass:meta`
// (`meta.apply(meta.get-mixin('display-type'))`, Д2). `sass:meta` itself is refused — a mixin kept in
// a variable carries the role under no name at all (Е2) — and so is `@extend`, by the config (Е3).

import { readFileSync } from 'node:fs'
import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/display-type-whole'

const SET_BY_THE_MIXIN = new Set([
  'all',
  'font',
  'font-family',
  'font-weight',
  'font-variation-settings',
])

const MIXIN = /@mixin\s+([\w-]+)[^{]*\{/g
const INCLUDE = /@include\s+([^;{]+)/g

const sassName = (name) => name.replaceAll('_', '-')

// The mixin an `@include` draws in: the name after a namespace, or the one `meta.get-mixin` names.
function includedName(params) {
  const viaMeta = /get-mixin\(\s*['"]?([\w-]+)/.exec(params)
  if (viaMeta) return viaMeta[1]
  return /^(?:[\w-]+\.)?([\w-]+)/.exec(params)?.[1]
}

// A placeholder anywhere in a selector — first, after a combinator or inside a pseudo-class (Г2, Д3).
const PLACEHOLDER = /(^|[\s>+~(,])%/

// The names of the mixins that include the role, directly or through another of them; comments are
// taken out first, so neither a word nor a brace in one changes what a mixin includes.
export function roleMixins(source, known = new Set(['display-type'])) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1')
  const bodies = []
  for (const match of code.matchAll(MIXIN)) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++
      if (code[end] === '}' && --depth === 0) break
    }
    bodies.push([sassName(match[1]), code.slice(match.index + match[0].length, end)])
  }
  const roles = new Set([...known].map(sassName))
  for (let grew = true; grew;) {
    grew = false
    for (const [name, body] of bodies) {
      if (roles.has(name)) continue
      const included = [...body.matchAll(INCLUDE)].map(([, params]) => includedName(params))
      if (included.some((name) => name && roles.has(sassName(name)))) {
        roles.add(name)
        grew = true
      }
    }
  }
  return roles
}

const SHARED = roleMixins(
  readFileSync(new URL('../src/styles/_mixins.scss', import.meta.url), 'utf8'),
)

const messages = ruleMessages(ruleName, {
  rejected: (prop) =>
    `${prop} beside @include display-type: a display role is Nunito at its one weight, whole.`,
  placeholder: () =>
    `display-type in a placeholder: @extend would carry the role into a rule this check cannot see.`,
  wrapper: (name) =>
    `${name} wraps the display role: a wrapper lives in styles/_mixins.scss only, where this check ` +
    `learns it.`,
  meta: () =>
    `sass:meta applies a mixin under any name, a display role among them, past this check. Include it.`,
})

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const ownFace = (container) =>
      (container.nodes ?? []).some(
        (node) =>
          node.type === 'decl' && node.prop === 'font-family' && node.value === 'var(--font)',
      )

    const roles = roleMixins(root.toString(), SHARED)

    const check = (container) => {
      for (const node of container.nodes ?? []) {
        if (node.type === 'decl' && SET_BY_THE_MIXIN.has(node.prop)) {
          report({ ruleName, result, node, message: messages.rejected(node.prop), word: node.prop })
        } else if (node.type === 'rule' && !ownFace(node)) {
          check(node)
        } else if (node.type === 'atrule') {
          check(node)
        }
      }
    }

    if (!root.source?.input.file?.endsWith('/styles/_mixins.scss')) {
      root.walkAtRules('mixin', (mixin) => {
        const name = sassName(/^[\w-]+/.exec(mixin.params)?.[0] ?? '')
        if (roles.has(name) && !SHARED.has(name)) {
          report({ ruleName, result, node: mixin, message: messages.wrapper(name), word: name })
        }
      })
    }

    root.walkAtRules('use', (use) => {
      if (/sass:meta/.test(use.params))
        report({ ruleName, result, node: use, message: messages.meta() })
    })

    root.walkAtRules('include', (include) => {
      const name = includedName(include.params)
      if (!name || !roles.has(sassName(name)) || !include.parent) return
      // Up through the media queries to the rule they belong to; a mixin's body is its own place.
      let parent = include.parent
      while (
        parent.type === 'atrule' &&
        parent.name !== 'mixin' &&
        parent.parent &&
        parent.parent.type !== 'root'
      ) {
        parent = parent.parent
      }
      if (parent.type === 'rule' && PLACEHOLDER.test(parent.selector.trim())) {
        report({ ruleName, result, node: include, message: messages.placeholder() })
        return
      }
      check(parent)
    })
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
