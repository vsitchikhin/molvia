import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

// Layer boundaries from CLAUDE.md. They are rules of the architecture, not style:
// they are checked here so that a violation fails `make lint` instead of a review.
const deny = (group, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
})

export default defineConfigWithVueTs(
  {
    ignores: [
      '**/dist/**',
      '**/dev-dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.scratch/**',
      '.lavish/**',
    ],
  },
  js.configs.recommended,
  vue.configs['flat/recommended'],

  // The top tier, and type-aware: without a type checker a linter cannot see a floating
  // promise, an unsafe any or a condition that is always true. Vue SFCs go through the
  // same checker, so a .vue file is no weaker than a .ts one.
  vueTsConfigs.strictTypeChecked,
  vueTsConfigs.stylisticTypeChecked,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir },
    },
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // Config and helper scripts are plain JS: there is no project to type-check them against.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [ts.configs.disableTypeChecked],
    rules: { '@typescript-eslint/explicit-module-boundary-types': 'off' },
  },

  {
    files: ['apps/pwa/**/*.{ts,vue}'],
    languageOptions: { globals: { ...globals.browser } },
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

  {
    files: ['packages/model/**/*.ts'],
    rules: deny(
      [
        'fastify',
        'fastify/*',
        'drizzle-orm*',
        'postgres',
        'pg',
        'vue',
        'vue/*',
        'node:*',
        '@molvia/*',
      ],
      'The domain imports nothing but zod. If a rule needs I/O or a framework, it is not a domain rule.',
    ),
  },
  {
    files: ['apps/api/src/usecases/**/*.ts'],
    rules: deny(
      ['fastify', 'fastify/*', 'fastify-*', '@fastify/*'],
      'Use cases know nothing about HTTP: no request, no reply, no status codes.',
    ),
  },
  {
    files: ['apps/api/src/routes/**/*.ts'],
    rules: deny(
      ['drizzle-orm*', 'postgres', 'pg', '**/db', '**/db/*'],
      'Routes hold no business logic and never reach the database except through a use case.',
    ),
  },
  {
    files: ['apps/bot/**/*.ts'],
    rules: deny(
      ['drizzle-orm*', 'postgres', 'pg'],
      'The API is the only write path; the bot is one of its clients.',
    ),
  },

  {
    files: ['**/*.test.ts', 'e2e/**/*.spec.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
)
