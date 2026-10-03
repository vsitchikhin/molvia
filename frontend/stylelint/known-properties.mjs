// A custom property read where nobody defines it (MOL-171, Е-1). `var(--space-5)` stood on two
// screens for weeks: the scale has no 5, the declaration was dropped as invalid at computed-value
// time, and nothing said so — the allowed-list of spacing takes any `--space-*` by its shape.
//
// A name is known when it is declared
//   - in styles/_tokens.scss, either scheme;
//   - in styles/main.scss or styles/_mixins.scss, which every component gets;
//   - in the file being linted — a component's own property, set beside where it is read;
//   - or by a script, and then it is named below with the file that sets it.
// A fallback does not make a name known: `var(--space-5, 1rem)` is the same typo.
//
// No dependency of its own: the token files are read once, by the same shape `bin/design-md.mjs`
// reads them — a declaration `--name:` — with comments taken out.

import { readFileSync } from 'node:fs'
import stylelint from 'stylelint'

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint

const ruleName = 'molvia/known-custom-property'

// Set from script or a `:style` binding, never declared in a stylesheet. One place, so a false
// alarm is fixed here and not by a disable comment in the component.
export const SET_BY_SCRIPT = {
  '--sheet-drag': 'composables/useSheetDrag.ts',
}

const GLOBAL_FILES = ['_tokens.scss', 'main.scss', '_mixins.scss']

const DECLARATION = /(--[\w-]+)\s*:/g
const REFERENCE = /var\(\s*(--[\w-]+)/g

function declaredIn(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(DECLARATION)].map((m) => m[1])
}

const GLOBAL = new Set([
  ...GLOBAL_FILES.flatMap((file) =>
    declaredIn(readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8')),
  ),
  ...Object.keys(SET_BY_SCRIPT),
])

const messages = ruleMessages(ruleName, {
  rejected: (name) =>
    `${name} is defined nowhere: not in styles/_tokens.scss, not in this file, and no script sets ` +
    `it (frontend/stylelint/known-properties.mjs).`,
})

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const local = new Set()
    root.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) local.add(decl.prop)
    })

    const check = (node, text) => {
      for (const match of text.matchAll(REFERENCE)) {
        const name = match[1]
        if (GLOBAL.has(name) || local.has(name)) continue
        report({ ruleName, result, node, message: messages.rejected(name), word: name })
      }
    }
    root.walkDecls((decl) => check(decl, decl.value))
    root.walkAtRules((atRule) => check(atRule, atRule.params))
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
