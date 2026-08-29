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
    },
  },
  prettier,
)
