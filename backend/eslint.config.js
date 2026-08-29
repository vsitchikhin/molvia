import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base, deny } from '../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default ts.config(
  ...base({ tsconfigRootDir }),
  {
    files: ['src/usecases/**/*.ts'],
    rules: deny(
      ['fastify', 'fastify/*', 'fastify-*', '@fastify/*'],
      'Use cases know nothing about HTTP: no request, no reply, no status codes.',
    ),
  },
  {
    files: ['src/routes/**/*.ts'],
    rules: deny(
      ['drizzle-orm*', 'postgres', 'pg', '@/db', '@/db/*'],
      'Routes hold no business logic and never reach the database except through a use case.',
    ),
  },
  prettier,
)
