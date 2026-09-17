import { fileURLToPath } from 'node:url'
import vue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import prettier from 'eslint-config-prettier'
import { base } from '../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * The defaults of `vue/no-bare-strings-in-template`, copied from the plugin so the options
 * below can extend them instead of replacing them.
 *
 * Kept as a named constant rather than inlined because the rule's options are silently
 * destructive: passing `attributes` drops every attribute the plugin checked by default, and
 * nothing reports the loss — the rule simply stops looking there.
 */
const BARE_STRING_DEFAULTS = {
  allowlist: [
    '(',
    ')',
    ',',
    '.',
    '&',
    '+',
    '-',
    '=',
    '*',
    '/',
    '#',
    '%',
    '!',
    '?',
    ':',
    '[',
    ']',
    '{',
    '}',
    '<',
    '>',
    '·',
    '•',
    '‐',
    '–',
    '—',
    '−',
    '|',
  ],
  attributes: {
    '/.+/': ['title', 'aria-label', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext'],
    input: ['placeholder'],
    img: ['alt'],
  },
  directives: ['v-text'],
}

// The Vue preset puts .vue files through the same type checker as .ts, so an SFC is no
// weaker than a plain module and `any` has nowhere to hide.
export default defineConfigWithVueTs(
  ...base({ tsconfigRootDir, browser: true }),
  vue.configs['flat/recommended'],
  vueTsConfigs.strictTypeChecked,
  vueTsConfigs.stylisticTypeChecked,
  {
    files: ['**/*.{ts,vue}'],
    rules: {
      // Block order is house style, kept by the linter rather than by memory.
      'vue/block-order': ['error', { order: ['template', 'script', 'style'] }],
      'vue/component-api-style': ['error', ['options', 'composition']],
      'vue/define-macros-order': 'error',
      'vue/no-undef-components': [
        'error',
        { ignorePatterns: ['RouterView', 'RouterLink', 'router-view', 'router-link'] },
      ],
      'vue/no-unused-refs': 'error',
      'vue/prefer-true-attribute-shorthand': 'error',
      'vue/enforce-style-attribute': ['error', { allow: ['scoped'] }],
      'vue/block-lang': ['error', { script: { lang: 'ts' }, style: { lang: 'scss' } }],

      // «Not a single string of text in the markup» is written in CLAUDE.md, repeated in the
      // design foundations and listed in the handoff's acceptance checklist — and until now it
      // was kept by memory alone. The plugin is already here, so the rule costs no dependency.
      //
      // Both options REPLACE the plugin's defaults rather than extend them, so each one is
      // spread over its default. Written out by hand, the lists silently lost
      // `aria-valuetext` — the attribute the 1–5 rating scale announces «Оценка 3 из 5» with,
      // for which `verdict.scale_label` exists — along with `−`, `%` and `!`, which a price
      // screen cannot avoid.
      //
      // What the rule does NOT catch, so nobody mistakes its silence for proof:
      //   {{ 'Литерал' }}          — an expression, neither a text node nor an attribute
      //   :aria-label="'Назад'"    — a bound attribute; one colon away from being caught
      //   a string built in <script> and handed over through a variable
      // It closes carelessness, not intent.
      'vue/no-bare-strings-in-template': [
        'error',
        {
          // Separators and signs rather than words: not text, and not translated.
          //
          // The rule cuts every listed entry out of the node and looks at what is left
          // (`getBareString` → `result.replace(allowlistRe, '')`), so «−» passes while «−12 %»
          // does not: after «−» and «%» are removed the digits remain. That is the right
          // behaviour rather than a gap — a number written into the markup is as untranslatable
          // as a word, and every real one arrives through interpolation, which the rule ignores.
          allowlist: [...BARE_STRING_DEFAULTS.allowlist, '≈', '×', '֏', '₽', '…'],
          attributes: {
            ...BARE_STRING_DEFAULTS.attributes,
            '/.+/': [...BARE_STRING_DEFAULTS.attributes['/.+/'], 'placeholder', 'alt', 'label'],
          },
          directives: [...BARE_STRING_DEFAULTS.directives, 'v-html'],
        },
      ],
    },
  },
  prettier,
)
