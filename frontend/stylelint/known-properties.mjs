// A custom property read where nobody defines it (MOL-171, Е-1). `var(--space-5)` stood on two
// screens for weeks: the scale has no 5, the declaration was dropped as invalid at computed-value
// time, and nothing said so — the allowed-list of spacing takes any `--space-*` by its shape.
//
// A name is known when it is declared
//   - in styles/_tokens.scss, in `:root` — a name the dark scheme alone declares is undefined in the
//     light one, and is refused in _tokens.scss itself;
//   - in styles/main.scss or styles/_mixins.scss, which every component gets;
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

// The body of the first block that opens after `opener`, braces counted.
function blockOf(code, opener) {
  const at = code.indexOf(opener)
  if (at < 0) throw new Error(`no ${opener} in _tokens.scss`)
  const start = code.indexOf('{', at)
  let depth = 0
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++
    if (code[i] === '}' && --depth === 0) return code.slice(start + 1, i)
  }
  throw new Error(`unclosed ${opener} in _tokens.scss`)
}

const styles = (file) =>
  withoutComments(readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8'))

const ROOT = new Set(declaredIn(blockOf(styles('_tokens.scss'), ':root')))

const GLOBAL = new Set([
  ...ROOT,
  ...declaredIn(styles('main.scss')),
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
