// A display role is whole (MOL-171, Ф-7, owner's В-3): a rule that includes `display-type` sets
// neither the face nor the weight nor the variation axis itself. The allowed-list cannot see this —
// `font-weight: var(--weight-regular)` is a fine value anywhere else — and after the include it
// draws the dram sign at 400 beside figures at 800 (the Dram face has three weights, Nunito one),
// while `font-variation-settings` moves Nunito's own axis, the file being a variable font.
//
// The whole rule is read, down its nested at-rules: an `@media` or `@include wider-than-phone`
// inside it is the same element on a wider screen (adversarial Б2). A nested rule is another element
// or a variant, and may set these only together with a face of its own — a sentence in a figure's
// place (`&.missing`) is Onest — `font-family: var(--font)`, never `inherit`, which keeps Nunito (В2);
// a variant that stays in Nunito keeps its one weight (Б1). Another rule for the same element
// elsewhere in the file is beyond what a linter can match (Б3), and so the role is never put in a
// placeholder, where `@extend` would carry it into such a rule (В3).
//
// A mixin that includes the role is the role (В1): its name is learnt from styles/_mixins.scss when
// the plugin loads, and from the file being linted, through any number of wrappers.

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
const INCLUDE = /@include\s+([\w-]+)/g

// The names of the mixins that include the role, directly or through another of them.
export function roleMixins(code, known = new Set(['display-type'])) {
  const bodies = []
  for (const match of code.matchAll(MIXIN)) {
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++
      if (code[end] === '}' && --depth === 0) break
    }
    bodies.push([match[1], code.slice(match.index + match[0].length, end)])
  }
  const roles = new Set(known)
  for (let grew = true; grew;) {
    grew = false
    for (const [name, body] of bodies) {
      if (roles.has(name)) continue
      if ([...body.matchAll(INCLUDE)].some(([, included]) => roles.has(included))) {
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

    root.walkAtRules('include', (include) => {
      const name = /^[\w-]+/.exec(include.params)?.[0]
      if (!name || !roles.has(name) || !include.parent) return
      if (include.parent.type === 'rule' && include.parent.selector.trim().startsWith('%')) {
        report({ ruleName, result, node: include, message: messages.placeholder() })
        return
      }
      check(include.parent)
    })
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
