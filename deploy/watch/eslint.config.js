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
      ['node:*'],
      'The watch runs on Cloudflare Workers: what it uses is the web platform, not Node.',
    ),
  },
  // The source is typed by the web platform alone (`tsconfig.json`), so Node's API there is a type
  // error; the tests run on Node, typed by `tests/tsconfig.json`, which the service finds by itself.
  // Only the Vitest config is in neither and goes to the default project, one file of its eight.
  // Set for every file: the parser keeps one project service per module, made with the options of
  // the first file it reads.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts'],
          defaultProject: 'tests/tsconfig.json',
        },
        tsconfigRootDir,
      },
    },
  },
  prettier,
)
