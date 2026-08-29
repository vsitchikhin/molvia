import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base, deny } from '../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default ts.config(
  ...base({ tsconfigRootDir }),
  {
    files: ['src/**/*.ts'],
    rules: deny(
      ['drizzle-orm*', 'postgres', 'pg'],
      'The API is the only write path; the bot is one of its clients.',
    ),
  },
  prettier,
)
