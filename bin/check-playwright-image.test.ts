import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageProblems } from './check-playwright-image.mjs'

const IMAGE = 'mcr.microsoft.com/playwright'

const workflow = (...tags: string[]): string =>
  tags.map((tag) => `    container:\n      image: ${IMAGE}:${tag}\n`).join('')

// Paths as the lockfile writes them; a bare name is the root's `node_modules/<name>`.
const lockfile = (versions: Record<string, string>): string =>
  JSON.stringify({
    packages: Object.fromEntries(
      Object.entries(versions).map(([path, version]) => [
        path.startsWith('node_modules/') ? path : `node_modules/${path}`,
        { version },
      ]),
    ),
  })

const at = (version: string): Record<string, string> => ({
  '@playwright/test': version,
  playwright: version,
  'playwright-core': version,
})

const ALL = lockfile(at('1.63.0'))

const told = (tag: string, name: string, version: string, to = `v${version}-noble`): string =>
  `the image is ${IMAGE}:${tag}, package-lock.json has ${name} ${version}: set the tag in .github/workflows/ci.yml to ${to}`

describe('imageProblems', () => {
  it('is quiet when the image is the version of the whole chain', () => {
    expect(imageProblems(workflow('v1.63.0-noble'), ALL)).toEqual([])
    expect(imageProblems(workflow('v1.63.0'), ALL)).toEqual([])
    expect(imageProblems(workflow('v1.63.0-resolute-amd64', 'v1.63.0-arm64'), ALL)).toEqual([])
  })

  it('names the tag to set when the lockfile was raised without the image', () => {
    expect(imageProblems(workflow('v1.63.0-noble'), lockfile(at('1.64.0')))).toEqual([
      told('v1.63.0-noble', '@playwright/test', '1.64.0'),
      told('v1.63.0-noble', 'playwright', '1.64.0'),
      told('v1.63.0-noble', 'playwright-core', '1.64.0'),
    ])
  })

  it('keeps the suffix of the tag it names, and refuses a patch apart', () => {
    expect(imageProblems(workflow('v1.63.1-jammy'), ALL)[0]).toBe(
      told('v1.63.1-jammy', '@playwright/test', '1.63.0', 'v1.63.0-jammy'),
    )
    expect(imageProblems(workflow('v1.63.1'), ALL)).toHaveLength(3)
  })

  it('refuses when the packages part, even with the image on one of them', () => {
    expect(
      imageProblems(workflow('v1.63.0-noble'), lockfile({ ...at('1.63.0'), playwright: '1.62.0' })),
    ).toEqual([told('v1.63.0-noble', 'playwright', '1.62.0')])
  })

  // Adversarial А1: another dependency's `playwright` hoisted to the root, the runner's own nested in it.
  it('takes each package where Node resolves it from the one before, not the hoisted one', () => {
    const hoisted = lockfile({
      '@playwright/test': '1.63.0',
      'node_modules/@playwright/test/node_modules/playwright': '1.63.0',
      playwright: '1.62.0',
      'playwright-core': '1.63.0',
    })
    expect(imageProblems(workflow('v1.63.0-noble'), hoisted)).toEqual([])
    expect(imageProblems(workflow('v1.62.0-noble'), hoisted)).toHaveLength(3)
  })

  // Adversarial А2: a version with a hyphen of its own.
  it('takes a prerelease whole', () => {
    const version = '1.64.0-beta-1761300000000'
    expect(imageProblems(workflow(`v${version}-noble`), lockfile(at(version)))).toEqual([])
    expect(imageProblems(workflow('v1.64.0-noble'), lockfile(at(version)))[0]).toBe(
      told('v1.64.0-noble', '@playwright/test', version),
    )
    expect(imageProblems(workflow('v1.63.0-beta'), ALL)).toHaveLength(3)
  })

  // Adversarial А3: the image is the key's value, never a comment's words.
  it('reads the image, not a comment', () => {
    const comment = (words: string): string => `    # ${words}\n`
    expect(
      imageProblems(comment(`was ${IMAGE}:v1.62.0-noble`) + workflow('v1.63.0-noble'), ALL),
    ).toEqual([])
    expect(
      imageProblems(comment(`pinned to ${IMAGE}:v1.63.0-noble`) + workflow('noble'), ALL),
    ).toEqual([
      told('noble', '@playwright/test', '1.63.0'),
      told('noble', 'playwright', '1.63.0'),
      told('noble', 'playwright-core', '1.63.0'),
    ])
    expect(imageProblems(workflow('${{ vars.PLAYWRIGHT_TAG }}'), ALL)).toHaveLength(3)
    expect(
      imageProblems(`    container: '${IMAGE}:v1.62.0-noble' # short form\n`, ALL),
    ).toHaveLength(3)
  })

  // Adversarial Б1: a digest pins the tag; the tag is still what is checked.
  it('reads the tag before a digest, and asks for the digest with a tag moved', () => {
    const digest = `@sha256:${'a1'.repeat(32)}`
    expect(imageProblems(workflow(`v1.63.0-noble${digest}`), ALL)).toEqual([])
    expect(imageProblems(workflow(`v1.62.0-noble${digest}`), ALL)[0]).toBe(
      told(
        `v1.62.0-noble${digest}`,
        '@playwright/test',
        '1.63.0',
        'v1.63.0-noble, and its digest with it',
      ),
    )
    expect(imageProblems(`    container:\n      image: ${IMAGE}${digest}\n`, ALL)).toHaveLength(3)
  })

  it('refuses a second image that is not the version', () => {
    expect(imageProblems(workflow('v1.63.0-noble', 'v1.62.0-noble'), ALL)).toHaveLength(3)
  })

  it('refuses a workflow with no image, and a lockfile without the chain', () => {
    expect(imageProblems('jobs: {}\n', ALL)).toEqual([
      'no image mcr.microsoft.com/playwright:v… in .github/workflows/ci.yml',
    ])
    expect(imageProblems(workflow('v1.63.0-noble'), lockfile({}))).toEqual([
      '@playwright/test is not in package-lock.json',
    ])
    expect(
      imageProblems(workflow('v1.63.0-noble'), lockfile({ '@playwright/test': '1.63.0' })),
    ).toEqual(['playwright is not in package-lock.json, from node_modules/@playwright/test'])
  })

  it('holds the repository as it stands', () => {
    expect(
      imageProblems(
        readFileSync('.github/workflows/ci.yml', 'utf8'),
        readFileSync('package-lock.json', 'utf8'),
      ),
    ).toEqual([])
  })
})
