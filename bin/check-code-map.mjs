// Refuses a code map that lies (MOL-133): `docs/map/*.md` is where a session looks before it
// searches the repository, and a map that names a moved file or misses a new one sends it to the
// wrong place — worse than no map at all.
//
// An entry is a list item that starts with a path in backticks: `- \`path\` — what it is`. Prose
// is never read as a path, so a convention like `x.test.ts` can be written anywhere else.
//
// A tracked file is covered when
//   - an entry names it;
//   - it is a test and an entry names its source: `x.test.ts` beside `x.ts` or `x.vue`, or
//     `packages/model/tests/a/b.test.ts` mirroring `packages/model/src/a/b.ts`;
//   - it is not code (its extension is in DIRECTORY_COVERED) and an entry names a directory above
//     it, with a trailing slash — migrations, icons, fonts.
// A file named by two entries has two homes, and that is refused too: the map gives one. A path an
// entry mentions after its own («Tests: `…`») must exist as well.
//
//   node bin/check-code-map.mjs

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import process from 'node:process'

const MAP = 'docs/map'

// Documentation, not code: the map of it is docs/README.md.
const OUT_OF_SCOPE = [
  /^docs\//,
  /^\.claude\//,
  /^CLAUDE\.md$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^package-lock\.json$/,
]

// What a directory entry may stand in for. Anything else — code, config, a Dockerfile, a hook with
// no extension — is named by its own entry.
const DIRECTORY_COVERED = /\.(sql|json|svg|png|ico|woff2|xml|xlsx|txt|webmanifest)$/

const ENTRY = /^\s*[-*]\s+`([^`]+)`/

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
const trackedSet = new Set(tracked)
const directories = new Set(
  tracked.flatMap((file) =>
    file
      .split('/')
      .slice(0, -1)
      .map((_, i, parts) => `${parts.slice(0, i + 1).join('/')}/`),
  ),
)

const topDirectories = new Set(
  [...directories].filter((directory) => directory.indexOf('/') === directory.length - 1),
)

const problems = []
const named = new Map()
const coveringDirectories = []

for (const name of readdirSync(MAP)
  .filter((file) => file.endsWith('.md'))
  .sort()) {
  const source = `${MAP}/${name}`
  readFileSync(source, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const path = ENTRY.exec(line)?.[1]
      if (path === undefined) return
      const where = `${source}:${index + 1}`
      // A path the description points at («Tests: `…`») must lead somewhere too. Only a path into
      // one of the repository's directories: a route (`/money/accounts`) or a build output
      // (`dist/gates.js`) is not a file of the repository.
      for (const [, mentioned] of line
        .slice(line.indexOf(path) + path.length)
        .matchAll(/`([^`\s]+\/[^`\s]*)`/g)) {
        if (!topDirectories.has(`${mentioned.split('/')[0]}/`)) continue
        if (!trackedSet.has(mentioned) && !directories.has(mentioned)) {
          problems.push(
            `no such path       ${mentioned}  (${where}) → moved or removed? fix the entry`,
          )
        }
      }
      if (path.endsWith('/')) {
        if (directories.has(path)) coveringDirectories.push(path)
        else
          problems.push(`no such directory  ${path}  (${where}) → moved or removed? fix the entry`)
        return
      }
      if (!trackedSet.has(path)) {
        problems.push(`no such file       ${path}  (${where}) → moved or removed? fix the entry`)
        return
      }
      const first = named.get(path)
      if (first) problems.push(`two homes          ${path}  (${first} and ${where}) → keep one`)
      else named.set(path, where)
    })
}

const sourceOf = (test) => {
  const base = test.replace(/\.test\.ts$/, '')
  const candidates = [`${base}.ts`, `${base}.vue`]
  if (test.startsWith('packages/model/tests/')) {
    candidates.push(`${base.replace('packages/model/tests/', 'packages/model/src/')}.ts`)
  }
  return candidates.find((candidate) => named.has(candidate))
}

const covered = (file) =>
  named.has(file) ||
  (file.endsWith('.test.ts') && sourceOf(file) !== undefined) ||
  (DIRECTORY_COVERED.test(file) &&
    coveringDirectories.some((directory) => file.startsWith(directory)))

for (const file of tracked) {
  if (OUT_OF_SCOPE.some((pattern) => pattern.test(file)) || covered(file)) continue
  problems.push(`not in the map     ${file}  → add an entry to ${MAP}/<area>.md`)
}

if (problems.length > 0) {
  console.error(`code map: ${problems.length} problem${problems.length === 1 ? '' : 's'}`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
