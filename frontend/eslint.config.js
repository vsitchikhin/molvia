import { fileURLToPath } from 'node:url'
import vue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import prettier from 'eslint-config-prettier'
import { base } from '../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

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
      // Attributes are listed separately because text in an aria-label is no different from
      // text in a node, yet it slips past a check that only walks text nodes. What the rule
      // cannot see is a string built in <script> and handed to the template through a
      // variable: it closes carelessness, not intent, and that is the cheap mistake worth
      // closing.
      //
      // The allowlist is separators and signs rather than words — they are not text and are
      // not translated.
      'vue/no-bare-strings-in-template': [
        'error',
        {
          allowlist: ['·', '≈', '×', '—', '–', '֏', '/', '(', ')', ',', '.', ':', '|'],
          attributes: { '/.+/': ['placeholder', 'aria-label', 'title', 'alt', 'label'] },
          directives: ['v-text'],
        },
      ],
    },
  },
  prettier,
)
