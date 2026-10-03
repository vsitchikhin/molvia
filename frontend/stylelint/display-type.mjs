// A display role is whole (MOL-171, Ф-7, owner's В-3): a rule that includes `display-type` sets
// neither the face nor the weight nor the variation axis itself. The allowed-list cannot see this —
// `font-weight: var(--weight-regular)` is a fine value anywhere else — and after the include it
// draws the dram sign at 400 beside figures at 800 (the Dram face has three weights, Nunito one),
// while `font-variation-settings` moves Nunito's own axis, the file being a variable font.

import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/display-type-whole'

const SET_BY_THE_MIXIN = new Set(['font', 'font-family', 'font-weight', 'font-variation-settings'])

const messages = ruleMessages(ruleName, {
  rejected: (prop) =>
    `${prop} beside @include display-type: a display role is Nunito at its one weight, whole.`,
})

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    root.walkAtRules('include', (include) => {
      if (!/^display-type\b/.test(include.params)) return
      for (const node of include.parent?.nodes ?? []) {
        if (node.type !== 'decl' || !SET_BY_THE_MIXIN.has(node.prop)) continue
        report({ ruleName, result, node, message: messages.rejected(node.prop), word: node.prop })
      }
    })
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
