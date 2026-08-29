import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base } from './eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

// Only what lives outside the modules: the end-to-end suite and the repository's own
// config files. Each module lints itself with its own config.
export default ts.config(
  { ignores: ['frontend/**', 'backend/**', 'bot/**', 'packages/**'] },
  ...base({ tsconfigRootDir }),
  prettier,
)
