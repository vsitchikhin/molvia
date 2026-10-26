// Refuses an image of Playwright in CI that is not the version the lockfile installs (MOL-295): the
// end-to-end job runs in `mcr.microsoft.com/playwright:v<version>-noble`, whose browsers are built for
// that one version, and Playwright of another refuses to start at the first test. Playwright names the
// tag itself there, in the end-to-end job; this says it in the checks job too, in one sentence, so a
// pull request of Dependabot that raised @playwright/test with its weekly group — never the tag — reads
// as the tag to move, not as a broken suite.
//
//   node bin/check-playwright-image.mjs

import { readFileSync } from 'node:fs'
import process from 'node:process'

const WORKFLOW = '.github/workflows/ci.yml'
const LOCKFILE = 'package-lock.json'
const REPOSITORY = 'mcr.microsoft.com/playwright'

// The runner, the library it loads and the core that refuses an image of another version — each where
// Node finds it from the one before, so a `playwright` another dependency hoisted is not taken for the
// runner's own (adversarial А1).
const CHAIN = ['@playwright/test', 'playwright', 'playwright-core']

// The value of an `image:` key, or of `container:` given as a string — never a comment's words
// (adversarial А3).
const IMAGE =
  /^[\t ]*(?:-[\t ]+)?(?:image|container):[\t ]*['"]?(mcr\.microsoft\.com\/playwright[^#\n]*?)['"]?[\t ]*(?:#.*)?$/gm

// A tag is `v<version>`, then the Ubuntu the image is built on and its architecture, each optional —
// the suffixes MCR publishes (26.10.2026). Matched as these words rather than any, so a version with a
// hyphen of its own, `1.64.0-beta-1761300000000`, stays whole (adversarial А2) and `v1.64.0-beta` is no
// suffix of 1.64.0; a new base is a word here.
const SUFFIX = /(?:-(?:bionic|focal|jammy|noble|resolute))?(?:-(?:amd64|arm64))?$/

/** Where Node resolves `name` from the package at `from` (a lockfile path, '' for the root). */
function resolved(packages, from, name) {
  for (let dir = from; ; dir = dir.slice(0, Math.max(dir.lastIndexOf('/node_modules/'), 0))) {
    const path = `${dir ? `${dir}/` : ''}node_modules/${name}`
    if (packages[path]) return path
    if (!dir) return undefined
  }
}

/**
 * What is wrong between the workflow and the lockfile, in sentences; empty when every image of
 * Playwright is the version the runner loads.
 */
export function imageProblems(workflow, lockfile) {
  const images = [...workflow.matchAll(IMAGE)].map((match) => match[1])
  if (images.length === 0) return [`no image ${REPOSITORY}:v… in ${WORKFLOW}`]
  const packages = JSON.parse(lockfile).packages ?? {}
  const installed = []
  let from = ''
  for (const name of CHAIN) {
    const path = resolved(packages, from, name)
    const version = path && packages[path].version
    if (!version) return [`${name} is not in ${LOCKFILE}${from ? `, from ${from}` : ''}`]
    installed.push({ name, version })
    from = path
  }
  const problems = []
  for (const image of new Set(images)) {
    // A digest after the tag pins what the tag names (adversarial Б1): the tag is still the version, and
    // a tag moved needs the digest of the new one, which only the registry knows.
    const [reference, digest] = image.split('@')
    const tag = reference.slice(REPOSITORY.length + 1)
    const suffix = tag.match(SUFFIX)?.[0] ?? ''
    for (const { name, version } of installed) {
      if (tag === `v${version}${suffix}`) continue
      problems.push(
        `the image is ${image}, ${LOCKFILE} has ${name} ${version}: set the tag in ${WORKFLOW} to ` +
          `v${version}${suffix || '-noble'}${digest ? ', and its digest with it' : ''}`,
      )
    }
  }
  return problems
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const problems = imageProblems(readFileSync(WORKFLOW, 'utf8'), readFileSync(LOCKFILE, 'utf8'))
  if (problems.length > 0) {
    console.error('playwright image (MOL-295):')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
}
