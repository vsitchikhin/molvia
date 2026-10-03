// A display role is whole (MOL-171, Ф-7, owner's В-3): a rule that includes `display-type` sets
// neither the face nor the weight nor the variation axis itself. The allowed-list cannot see this —
// `font-weight: var(--weight-regular)` is a fine value anywhere else — and after the include it
// draws the dram sign at 400 beside figures at 800 (the Dram face has three weights, Nunito one),
// while `font-variation-settings` moves Nunito's own axis, the file being a variable font.
//
// The whole rule is read, down its nested at-rules: an `@media` or `@include wider-than-phone`
// inside it is the same element on a wider screen (adversarial Б2). A nested rule is another element
// or a variant, and may set these only together with a face of its own — a sentence in a figure's
// place (`&.missing`) is Onest; a variant that stays in Nunito keeps its one weight (Б1). Another
// rule for the same element elsewhere in the file is beyond what a linter can match (Б3).

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

const messages = ruleMessages(ruleName, {
  rejected: (prop) =>
    `${prop} beside @include display-type: a display role is Nunito at its one weight, whole.`,
})

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const ownFace = (container) =>
      (container.nodes ?? []).some((node) => node.type === 'decl' && node.prop === 'font-family')

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
      if (/^display-type\b/.test(include.params) && include.parent) check(include.parent)
    })
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
