import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { imageProblems } from './check-playwright-image.mjs'

const workflow = (...tags: string[]): string =>
  tags.map((tag) => `    container:\n      image: mcr.microsoft.com/playwright:${tag}\n`).join('')

const lockfile = (versions: Record<string, string>): string =>
  JSON.stringify({
    packages: Object.fromEntries(
      Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }]),
    ),
  })

const BOTH = lockfile({ '@playwright/test': '1.63.0', playwright: '1.63.0' })

describe('imageProblems', () => {
  it('is quiet when the image is the version of both packages', () => {
    expect(imageProblems(workflow('v1.63.0-noble'), BOTH)).toEqual([])
  })

  it('names the tag to set when the lockfile was raised without the image', () => {
    expect(
      imageProblems(
        workflow('v1.63.0-noble'),
        lockfile({ '@playwright/test': '1.64.0', playwright: '1.64.0' }),
      ),
    ).toEqual([
      'the image is v1.63.0, package-lock.json has @playwright/test 1.64.0: set the tag in .github/workflows/ci.yml to v1.64.0',
      'the image is v1.63.0, package-lock.json has playwright 1.64.0: set the tag in .github/workflows/ci.yml to v1.64.0',
    ])
  })

  it('refuses a patch apart, and an image with no suffix of its base', () => {
    expect(imageProblems(workflow('v1.63.1'), BOTH)).toHaveLength(2)
  })

  it('refuses when the two packages part, even with the image on one of them', () => {
    expect(
      imageProblems(
        workflow('v1.63.0-noble'),
        lockfile({ '@playwright/test': '1.63.0', playwright: '1.62.0' }),
      ),
    ).toEqual([
      'the image is v1.63.0, package-lock.json has playwright 1.62.0: set the tag in .github/workflows/ci.yml to v1.62.0',
    ])
  })

  it('refuses a second image that is not the version', () => {
    expect(imageProblems(workflow('v1.63.0-noble', 'v1.62.0-noble'), BOTH)).toHaveLength(2)
  })

  it('refuses a workflow with no image, and a lockfile without the packages', () => {
    expect(imageProblems('jobs: {}\n', BOTH)).toEqual([
      'no image mcr.microsoft.com/playwright:v… in .github/workflows/ci.yml',
    ])
    expect(imageProblems(workflow('v1.63.0-noble'), lockfile({}))).toEqual([
      '@playwright/test is not in package-lock.json',
      'playwright is not in package-lock.json',
    ])
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
