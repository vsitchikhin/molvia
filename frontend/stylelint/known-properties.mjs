// A custom property read where nobody defines it (MOL-171, Е-1). `var(--space-5)` stood on two
// screens for weeks: the scale has no 5, the declaration was dropped as invalid at computed-value
// time, and nothing said so — the allowed-list of spacing takes any `--space-*` by its shape.
//
// A name is known when it is declared
//   - in a top-level `:root` of styles/_tokens.scss or styles/main.scss — a name only the dark scheme
//     or a media query declares is undefined in the light one (adversarial А5, Б5), and the dark
//     scheme's is refused in _tokens.scss itself;
//   - in the body of a mixin of styles/_mixins.scss, which every component gets — known everywhere,
//     though it is set only where the mixin is included (`--appear-rise`, read with a fallback);
//   - in the file being linted — a component's own property, set beside where it is read;
//   - or by a script, and then it is named below with the file that sets it.
// A fallback does not make a name known: `var(--space-5, 1rem)` is the same typo. A name built by
// interpolation (`var(--space-#{$n})`) is known only once Sass compiles it, and is not checked.
//
// No dependency of its own: the token files are read once, by the same shape `bin/design-md.mjs`
// reads them — a declaration `--name:` — with both kinds of comment taken out.

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

const DECLARATION = /(--[\w-]+)\s*:/g
const REFERENCE = /var\(\s*(--[\w-]+)(#\{)?/g

// A line comment starts where `//` follows the start of a line, a space or the end of a rule — never
// inside `url(https://…)`; it may close a line that declares something.
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1')
}

function declaredIn(code) {
  return [...code.matchAll(DECLARATION)].map((m) => m[1])
}

// The names declared directly in a rule whose selector is exactly `:root`, at the top level of a
// stylesheet — not in one nested in a media query, not under `:root:not(…)` or `[…]:root`, and not in
// a block nested inside `:root` itself (adversarial Б5, В4).
export function rootNames(code) {
  const names = []
  let depth = 0
  let statement = 0
  for (let i = 0; i < code.length; i++) {
    const char = code[i]
    if (char === '{') {
      if (depth === 0 && code.slice(statement, i).trim() === ':root') {
        let inner = 0
        let end = i
        for (; end < code.length; end++) {
          if (code[end] === '{') inner++
          if (code[end] === '}' && --inner === 0) break
        }
        let body = code.slice(i + 1, end)
        for (let nested = /[^{};]*\{[^{}]*\}/; nested.test(body);) body = body.replace(nested, '')
        names.push(...declaredIn(body))
        i = end
        statement = end + 1
        continue
      }
      depth++
      if (depth === 1) statement = i + 1
    } else if (char === '}') {
      depth--
      if (depth === 0) statement = i + 1
    } else if (char === ';' && depth === 0) {
      statement = i + 1
    }
  }
  return names
}

const styles = (file) =>
  withoutComments(readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8'))

const ROOT = new Set(rootNames(styles('_tokens.scss')))
if (ROOT.size === 0) throw new Error('no :root in _tokens.scss')

const GLOBAL = new Set([
  ...ROOT,
  ...rootNames(styles('main.scss')),
  ...declaredIn(styles('_mixins.scss')),
  ...Object.keys(SET_BY_SCRIPT),
])

const messages = ruleMessages(ruleName, {
  rejected: (name) =>
    `${name} is defined nowhere: not in styles/_tokens.scss, not in this file, and no script sets ` +
    `it (frontend/stylelint/known-properties.mjs).`,
  darkOnly: (name) =>
    `${name} is declared by the dark scheme alone: the light one has no value for it. Declare it ` +
    `in :root as well.`,
})

function rule(primary) {
  return (root, result) => {
    if (!validateOptions(result, ruleName, { actual: primary })) return

    const local = new Set()
    root.walkDecls((decl) => {
      if (decl.prop.startsWith('--')) local.add(decl.prop)
    })

    const check = (node, text) => {
      for (const [, name, interpolated] of text.matchAll(REFERENCE)) {
        if (interpolated || GLOBAL.has(name) || local.has(name)) continue
        report({ ruleName, result, node, message: messages.rejected(name), word: name })
      }
    }
    root.walkDecls((decl) => check(decl, decl.value))
    root.walkAtRules((atRule) => check(atRule, atRule.params))

    if (root.source?.input.file?.endsWith('/styles/_tokens.scss')) {
      root.walkAtRules('mixin', (mixin) => {
        if (!mixin.params.startsWith('dark-scheme')) return
        mixin.walkDecls((decl) => {
          if (!decl.prop.startsWith('--') || ROOT.has(decl.prop)) return
          report({
            ruleName,
            result,
            node: decl,
            message: messages.darkOnly(decl.prop),
            word: decl.prop,
          })
        })
      })
    }
  }
}

rule.ruleName = ruleName
rule.messages = messages

export default createPlugin(ruleName, rule)
