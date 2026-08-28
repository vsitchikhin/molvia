// Bundles an app into a single file for the production image.
//
// Bundling rather than shipping node_modules: the workspace packages export TypeScript
// source, so a runtime image would otherwise need the whole toolchain to read them. One
// file also means the image carries no dependency tree to audit or to drift.
//
//   node bin/bundle.mjs api
//   node bin/bundle.mjs bot

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const app = process.argv[2]
if (!['api', 'bot'].includes(app)) {
  console.error('usage: node bin/bundle.mjs <api|bot>')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))

await build({
  entryPoints: [`${root}apps/${app}/src/index.ts`],
  outfile: `${root}apps/${app}/dist/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false, // a readable stack trace is worth more than the kilobytes
  // ESM output cannot use require(); a few dependencies still reach for it.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      'const require = __createRequire(import.meta.url)',
    ].join('\n'),
  },
})

console.log(`bundled apps/${app}/dist/index.js`)
