import { fileURLToPath } from 'node:url'
import ts from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import { base, deny } from '../../eslint.config.base.js'

const tsconfigRootDir = fileURLToPath(new URL('.', import.meta.url))

const WEB_PLATFORM =
  'The watch runs on Cloudflare Workers: what it uses is the web platform, not Node.'

export default ts.config(
  ...base({ tsconfigRootDir }),
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      ...deny(['node:*'], WEB_PLATFORM),
      // Node's globals type-check here — the tests run on Node, and one TypeScript program sees
      // their types everywhere — and run in every test, then fail on Workers at the first round
      // (adversarial А4). The linter is what holds them out of the source.
      'no-restricted-globals': [
        'error',
        ...[
          'process',
          'Buffer',
          'global',
          'require',
          'module',
          '__dirname',
          '__filename',
          'setImmediate',
        ].map((name) => ({ name, message: WEB_PLATFORM })),
      ],
    },
  },
  prettier,
)
