import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Layer boundaries from CLAUDE.md. They are rules of the architecture, not style:
// they are checked here so that a violation fails `make lint` instead of a review.
const deny = (group, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message }] }],
})

export default ts.config(
  {
    ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**', '.scratch/**', '.lavish/**'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/pwa/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: ts.parser, extraFileExtensions: ['.vue'] },
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
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
)
