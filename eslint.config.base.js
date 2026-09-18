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
      files: ['src/**/*.{ts,vue}'],
      rules: { 'no-restricted-imports': ['error', { patterns: [...IMPORT_SHAPE, TEST_DATA] }] },
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
    message:
      "Reach across directories with the module's own alias instead of '../…': '@/…' in an " +
      "application, '#<package>/…' in a package that ships its source.",
  },
  {
    group: ['./*/*', './*/**'],
    message:
      "'./' is for a file in the same directory. For a subdirectory use the module's alias: " +
      "'@/…' in an application, '#<package>/…' in a package that ships its source.",
  },
]

/**
 * Test data a package exposes for other modules' tests — the search corpus is the first. It is
 * served by the package's exports like anything else, so only this keeps it out of `src`,
 * and `src` holds only what ships: an import there would put a test corpus into the bundle.
 */
export const TEST_DATA = {
  group: ['@molvia/*/testing', '@molvia/*/testing/*'],
  message: "A package's testing export is for tests only; src holds only what ships.",
}

/**
 * Deny a group of import specifiers with the reason the boundary exists. Meant for `src`
 * globs, which is where every boundary lives.
 *
 * ESLint replaces a rule's options rather than merging them, so a module that set only its
 * own patterns would silently switch off IMPORT_SHAPE and TEST_DATA. Every caller gets all.
 */
export function deny(group, message) {
  return {
    'no-restricted-imports': [
      'error',
      { patterns: [...IMPORT_SHAPE, TEST_DATA, { group, message }] },
    ],
  }
}
