import js from '@eslint/js'
import ts from 'typescript-eslint'
import globals from 'globals'

/**
 * What every module in this repository agrees on. Each module imports it from its own
 * eslint.config.js and adds its own rules — the way three separate repositories would
 * share a company preset. Nothing here knows the names of the modules.
 */
export function base({ tsconfigRootDir, browser = false }) {
  return [
    {
      ignores: [
        '**/dist/**',
        '**/dev-dist/**',
        '**/node_modules/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/coverage/**',
      ],
    },
    js.configs.recommended,

    // The top tier, and type-aware: without a type checker a linter cannot see a floating
    // promise, an unsafe any or a condition that is always true.
    ...ts.configs.strictTypeChecked,
    ...ts.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node, ...(browser ? globals.browser : {}) },
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
      files: ['**/*.{ts,vue}'],
      rules: { 'no-restricted-imports': ['error', { patterns: IMPORT_SHAPE }] },
    },

    {
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  ]
}

/**
 * Imports are either an alias or a sibling. A path that climbs out of its own folder hides
 * where a thing lives and breaks the moment a file moves; './sub/thing' hides it half as
 * much and still breaks.
 */
export const IMPORT_SHAPE = [
  {
    group: ['../*', '../**'],
    message: "Reach across directories with the module's own alias: '@/…' instead of '../…'.",
  },
  {
    group: ['./*/*', './*/**'],
    message: "'./' is for a file in the same directory. For a subdirectory use the alias: '@/…'.",
  },
]

/**
 * Deny a group of import specifiers with the reason the boundary exists.
 *
 * ESLint replaces a rule's options rather than merging them, so a module that set only its
 * own patterns would silently switch off IMPORT_SHAPE. Every caller gets both.
 */
export function deny(group, message) {
  return {
    'no-restricted-imports': ['error', { patterns: [...IMPORT_SHAPE, { group, message }] }],
  }
}
