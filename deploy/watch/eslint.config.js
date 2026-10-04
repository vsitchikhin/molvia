import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base, deny } from '../../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default ts.config(
  ...base({ tsconfigRootDir }),
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: deny(
      ['node:*'],
      'The watch runs on Cloudflare Workers: what it uses is the web platform, not Node.',
    ),
  },
  prettier,
)
