// Bundles an app into a single file for the production image.
//
// Bundling rather than shipping node_modules: the workspace packages export TypeScript
// source, so a runtime image would otherwise need the whole toolchain to read them. One
// file also means the image carries no dependency tree to audit or to drift.
//
//   node bin/bundle.mjs backend
//   node bin/bundle.mjs bot
//
// The API ships a second file beside its server: `dist/forget.js`, the owner's fallback for
// erasing a person by hand (MOL-58). The production machine has neither the source nor a
// published database port, so the image it already runs is the only place such a tool can live.

import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const app = process.argv[2]
if (!['backend', 'bot'].includes(app)) {
  console.error('usage: node bin/bundle.mjs <backend|bot>')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))

const entries = {
  backend: { index: 'src/index.ts', forget: 'src/forget-cli.ts' },
  bot: { index: 'src/index.ts' },
}

await build({
  entryPoints: Object.fromEntries(
    Object.entries(entries[app]).map(([name, path]) => [name, `${root}${app}/${path}`]),
  ),
  outdir: `${root}${app}/dist`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: false, // a readable stack trace is worth more than the kilobytes
  // What keeps the development login seam out of production (MOL-52, Р-14). Substituted here
  // rather than trusted at runtime: a variable can be set wrong and nobody finds out, whereas
  // a literal folds the condition in `server.ts` to `false`, the branch goes, and the module
  // behind it is tree-shaken away — the route is absent rather than switched off.
  //
  // esbuild only substitutes an **unbound** `process`, so this does nothing for a file that
  // imports it from `node:process`.
  define: { 'process.env.NODE_ENV': '"production"' },
  // And this is what actually removes the folded branch — measured, not assumed. With the
  // define alone esbuild emitted `if (false) { devActorRoute(...) }` verbatim: it drops dead
  // branches while minifying syntax, not while bundling.
  //
  // What it costs is honest to name. Identifiers keep their names, so a stack trace still says
  // which function threw; line numbers do move, and what puts them back is the sourcemap above
  // — which is why `sourcemap: true` is now load-bearing rather than a convenience. Applied to
  // both apps, though only the API has a seam: one bundler, one shape, and a second code path
  // for the bot would be a second thing to keep true.
  //
  // `bundle-seam.integration.test.ts` checks the built file rather than taking any of this on
  // trust: every step here fails silently, and what ships if one does is an open route.
  minifySyntax: true,
  // ESM output cannot use require(); a few dependencies still reach for it.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module'",
      'const require = __createRequire(import.meta.url)',
    ].join('\n'),
  },
})

console.log(
  `bundled ${Object.keys(entries[app])
    .map((name) => `${app}/dist/${name}.js`)
    .join(', ')}`,
)
