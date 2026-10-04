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
  // The source is typed by the web platform alone (`tsconfig.json`), so Node's API there is a type
  // error. The tests run on Node and are typed by `tsconfig.test.json`, which the source's project
  // does not include. Set for every file: the parser keeps one project service per module, made
  // with the options of the first file it reads.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['src/*.test.ts', '*.config.ts'],
          defaultProject: 'tsconfig.test.json',
        },
        tsconfigRootDir,
      },
    },
  },
  prettier,
)
