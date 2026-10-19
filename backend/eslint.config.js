import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base, boundary } from '../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

export default ts.config(
  ...base({ tsconfigRootDir }),
  ...boundary(
    ['src/usecases/**/*.ts'],
    ['fastify', 'fastify/*', 'fastify-*', '@fastify/*', '@/routes', '@/routes/*'],
    'Use cases know nothing about HTTP: no request, no reply, no status codes, no routes.',
  ),
  ...boundary(
    ['src/routes/**/*.ts'],
    ['drizzle-orm*', 'postgres', 'pg', '@/db', '@/db/*'],
    'Routes hold no business logic and never reach the database except through a use case.',
  ),
  ...boundary(
    ['src/rates/**/*.ts'],
    [
      'fastify',
      'fastify/*',
      '@/routes',
      '@/routes/*',
      '@/usecases',
      '@/usecases/*',
      '@/db',
      '@/db/*',
      'drizzle-orm*',
      'postgres',
    ],
    'A rate feed reads a provider and nothing else: the cache and the schedule decide what to keep.',
  ),
  prettier,
)
