// Refuses an image of Playwright in CI that is not the version the lockfile installs (MOL-295): the
// end-to-end job runs in `mcr.microsoft.com/playwright:v<version>-noble`, whose browsers are built for
// that one version, and Playwright of another refuses to start — but only at the first test, after
// `npm ci` and every server is up. Dependabot raises @playwright/test with the weekly group and never
// the tag, so the check says it here, in a sentence, a minute after the push.
//
//   node bin/check-playwright-image.mjs

import { readFileSync } from 'node:fs'
import process from 'node:process'

const WORKFLOW = '.github/workflows/ci.yml'
const LOCKFILE = 'package-lock.json'

// The packages whose version the image must be: the runner and the library it drives.
const PACKAGES = ['@playwright/test', 'playwright']

const IMAGE = /mcr\.microsoft\.com\/playwright:v([^\s'"-]+)/g

/**
 * What is wrong between the workflow and the lockfile, in sentences; empty when the image is the
 * version every package of Playwright is installed at.
 */
export function imageProblems(workflow, lockfile) {
  const tags = [...workflow.matchAll(IMAGE)].map((match) => match[1])
  if (tags.length === 0) return [`no image mcr.microsoft.com/playwright:v… in ${WORKFLOW}`]
  const packages = JSON.parse(lockfile).packages ?? {}
  const problems = []
  for (const name of PACKAGES) {
    const version = packages[`node_modules/${name}`]?.version
    if (!version) {
      problems.push(`${name} is not in ${LOCKFILE}`)
      continue
    }
    for (const tag of new Set(tags)) {
      if (tag !== version) {
        problems.push(
          `the image is v${tag}, ${LOCKFILE} has ${name} ${version}: set the tag in ${WORKFLOW} to v${version}`,
        )
      }
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
