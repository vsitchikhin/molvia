import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { IMPORT_SHAPE, TESTS_BESIDE_SOURCE, base, deny } from '../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

const WRITE_PATH = {
  group: ['drizzle-orm*', 'postgres', 'pg'],
  message: 'The API is the only write path; the bot is one of its clients.',
}

export default ts.config(
  ...base({ tsconfigRootDir }),
  {
    files: ['src/**/*.ts'],
    ignores: TESTS_BESIDE_SOURCE,
    rules: deny(WRITE_PATH.group, WRITE_PATH.message),
  },
  // Its tests take a package's testing export, and still not the database.
  {
    files: TESTS_BESIDE_SOURCE,
    rules: { 'no-restricted-imports': ['error', { patterns: [...IMPORT_SHAPE, WRITE_PATH] }] },
  },
  prettier,
)
