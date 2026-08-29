import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base } from '../../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default ts.config(...base({ tsconfigRootDir, browser: true }), prettier)
