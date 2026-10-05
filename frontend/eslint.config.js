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

/**
 * The selector of a busy button with no word of the work (MOL-225). A prop is the button's own
 * attribute, static or bound — of its start tag, never of an element in its slot — or a key of
 * what its `v-bind` gives it: the object itself, one spread into it, either side of a choice, a
 * cast (adversarial Р4-А1) — never a key of an object that is a value or an argument inside it
 * (`t('…', { busy })`, `meta: { busyLabel }`, Р3-А2). A word written as a string counts only
 * when it has a letter or a digit: `""`, `"…"`, `"..."`, `"—"` say nothing (Р4-А2, Р5-А1).
 */
function busyWithoutWord() {
  const object = 'VAttribute[directive=true][key.name.name="bind"][key.argument=null]'
  const own = `${object} Property:not(Property Property, CallExpression Property)`
  const template = '[key.type="TemplateLiteral"][key.expressions.length=0]'
  const key = (name) => [
    `${own}[computed=false][key.name=${name}]`,
    `${own}[key.value=${name}]`,
    `${own}${template}[key.quasis.0.value.cooked=${name}]`,
  ]
  const tag = (name, says = '') => [
    `VAttribute[directive=false][key.name=${name}]${says}`,
    // `v-model:busy` gives the button the same prop (Р5-А2); `v-on` gives an event, no prop.
    `VAttribute[directive=true][key.name.name=/^(bind|model)$/][key.argument.name=${name}]`,
  ]
  const has = (selectors) => selectors.map((one) => `:has(${one})`).join(', ')
  const busy = [...tag('"busy"'), ...key('"busy"')]
  // A letter or a digit of any script: what is left of the rest says nothing (Р4-А2, Р5-А1).
  const says = '[value.value=/[\\p{L}\\p{N}]/u]'
  const word = [...tag('/^busy-?label$/i', says), ...key('/^busy-?label$/i')]
  // The start tag, not the element: its `:has()` reaches the button's own attributes alone.
  const button = 'VElement[rawName=/^(AppButton|app-button)$/] > VStartTag'
  return `${button}:matches(${has(busy)}):not(:matches(${has(word)}))`
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
            '/.+/': [
              ...BARE_STRING_DEFAULTS.attributes['/.+/'],
              'placeholder',
              'alt',
              'label',
              // The word of a button at work (MOL-225, adversarial Р3-А1).
              'busy-label',
            ],
          },
          directives: [...BARE_STRING_DEFAULTS.directives, 'v-html'],
        },
      ],
    },
  },
  // One way into the camera (MOL-163): the browser asks for it once per page load, and a second
  // caller of `getUserMedia` — a receipt with a viewfinder of its own — would bring a second set of
  // refusals, stops and states to keep in step. The receipt takes its photo through the system
  // camera (`<input capture>`), which asks the page for nothing. It closes carelessness, not intent:
  // a name computed or handed to `Reflect.get` passes (adversarial Г).
  {
    files: ['src/**/*.{ts,vue}'],
    ignores: ['src/composables/useCamera.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'getUserMedia',
          message: 'The camera is reached through useCamera only (MOL-163).',
        },
        {
          property: 'webkitGetUserMedia',
          message: 'The camera is reached through useCamera only (MOL-163).',
        },
        {
          property: 'mozGetUserMedia',
          message: 'The camera is reached through useCamera only (MOL-163).',
        },
      ],
    },
  },
  // One search field (MOL-177, Ф-12): «Что взяли?», «Что брать» and «Выбрать товар» had grown three
  // looks, and a fourth screen would draw a fourth. A field of search outside `SearchField` — by its
  // type or by the key it asks the keyboard for — is refused, as caps outside `SectionCaption` are.
  // A bound `:type` passes: it closes carelessness, not intent.
  {
    files: ['src/**/*.vue'],
    ignores: ['src/components/SearchField.vue'],
    rules: {
      'vue/no-restricted-static-attribute': [
        'error',
        {
          key: 'type',
          value: 'search',
          element: 'input',
          message: 'A search field is SearchField (MOL-177).',
        },
        {
          key: 'enterkeyhint',
          value: 'search',
          message: 'A search field is SearchField (MOL-177).',
        },
      ],
    },
  },
  // A busy button says what it does (MOL-225): at work it reads «Удаляем…» in place of its action's
  // word, in the action's look. Without its word it looked live — or, beside `disabled`, not now —
  // and the second tap was swallowed with nothing said. `busy` — alone, bound, by `v-model:busy`,
  // or a key of what the `v-bind` gives (the object, a spread, a choice, a cast), written as a
  // name, a string or a template with nothing in it — on `AppButton` or `app-button`, with no word
  // of the work beside it, is refused (adversarial Р1-А5, Р2-А1, Р3-А2, Р4-А1, Р5-А2). A word
  // written as a string counts when it has a letter or a digit — `""`, `"…"`, `"..."`, `"—"` say
  // nothing (Р4-А2, Р5-А1) — and that it is no key of the dictionary is
  // `vue/no-bare-strings-in-template`'s to say, which reads `busy-label` too (Р3-А1). What it
  // cannot see: a button at work through `disabled` or `inactive` alone, which reads the same as a
  // neighbour put out while another works; a key computed from a name; an object from the script
  // or a call; a word bound and empty. It closes carelessness, not intent.
  {
    files: ['src/**/*.vue'],
    rules: {
      'vue/no-restricted-syntax': [
        'error',
        {
          selector: busyWithoutWord(),
          message: 'A busy button says what it does: give it a busy-label (MOL-225).',
        },
      ],
    },
  },
  prettier,
)
