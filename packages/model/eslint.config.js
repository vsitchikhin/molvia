import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base, deny } from '../../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default ts.config(
  ...base({ tsconfigRootDir }),
  {
    files: ['src/**/*.ts'],
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
  prettier,
)
