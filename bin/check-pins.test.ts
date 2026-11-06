import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dockerfileProblems, pinProblems, workflowProblems } from './check-pins.mjs'

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'
const DIGEST = `sha256:${'0e17'.repeat(16)}`
const WORKFLOW = '.github/workflows/ci.yml'

const steps = (...lines: string[]): string => `jobs:\n  check:\n    steps:\n${lines.join('\n')}\n`

describe('workflowProblems', () => {
  it('is quiet on a full sha with its release in a comment, quoted or not, a job or a step', () => {
    const text = [
      steps(
        `      - uses: actions/checkout@${SHA} # v7.0.1`,
        `      - name: cache`,
        `        uses: 'actions/cache@${SHA}' #v6`,
      ),
      `  reuse:\n    uses: owner/repo/.github/workflows/x.yml@${SHA} # 1.2.0\n`,
    ].join('')
    expect(workflowProblems(WORKFLOW, text)).toEqual([])
  })

  it('refuses a tag, a branch and a short sha, by line', () => {
    const text = steps(
      '      - uses: actions/checkout@v7',
      '      - uses: docker/login-action@master',
      `      - uses: actions/cache@${SHA.slice(0, 7)} # v6.1.0`,
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual([
      `${WORKFLOW}:4: actions/checkout@v7 — pin it by the full commit sha, its release in a comment`,
      `${WORKFLOW}:5: docker/login-action@master — pin it by the full commit sha, its release in a comment`,
      `${WORKFLOW}:6: actions/cache@${SHA.slice(0, 7)} — pin it by the full commit sha, its release in a comment`,
    ])
  })

  it('refuses a sha without its release named, or a comment that names none', () => {
    const text = steps(
      `      - uses: actions/checkout@${SHA}`,
      `      - uses: actions/checkout@${SHA} # checkout`,
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual([
      `${WORKFLOW}:4: actions/checkout@${SHA} — name its release in a comment after it, # vX.Y.Z`,
      `${WORKFLOW}:5: actions/checkout@${SHA} — name its release in a comment after it, # vX.Y.Z`,
    ])
  })

  it('refuses a sha in capitals: it takes only the form Dependabot writes', () => {
    expect(
      workflowProblems(WORKFLOW, steps(`      - uses: a/b@${SHA.toUpperCase()} # v1`)),
    ).toHaveLength(1)
  })

  it('leaves a local action and a commented-out line alone', () => {
    const text = steps(
      '      - uses: ./.github/actions/setup',
      '      # - uses: actions/checkout@v7',
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual([])
  })

  it('takes a docker:// image only by its digest', () => {
    const text = steps(
      `      - uses: docker://alpine:3.22@${DIGEST}`,
      '      - uses: docker://alpine:3.22',
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual([
      `${WORKFLOW}:5: docker://alpine:3.22 — pin the image by its digest`,
    ])
  })
})

describe('dockerfileProblems', () => {
  const FILE = 'frontend/Dockerfile'
  const told = (line: number, image: string): string =>
    `${FILE}:${String(line)}: ${image} — pin it by an exact tag and its digest, image:tag@sha256:…`

  it('is quiet on a tag with its digest, a stage of the file, scratch and a platform flag', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST} AS build`,
      'RUN true',
      `from --platform=linux/amd64 ghcr.io/google/cadvisor:v0.60.6@${DIGEST} as Tools`,
      'FROM build AS again',
      'FROM tools',
      'FROM scratch',
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([])
  })

  it('refuses a floating tag, a tag without its digest, a digest without its tag and no tag at all', () => {
    const text = [
      'FROM caddy:2-alpine AS runtime',
      'FROM debian:trixie-slim',
      `FROM caddy@${DIGEST}`,
      'FROM localhost:5000/caddy',
      `FROM caddy:2.11.9-alpine@sha256:${'0'.repeat(63)}`,
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([
      told(1, 'caddy:2-alpine'),
      told(2, 'debian:trixie-slim'),
      told(3, `caddy@${DIGEST}`),
      told(4, 'localhost:5000/caddy'),
      told(5, `caddy:2.11.9-alpine@sha256:${'0'.repeat(63)}`),
    ])
  })

  it('takes a stage only after the file named it — a later stage of the name is still an image', () => {
    const text = ['FROM runtime', `FROM node:22.23.4-alpine@${DIGEST} AS runtime`].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([told(1, 'runtime')])
  })

  it('refuses a base image named by an argument, which it cannot read', () => {
    expect(dockerfileProblems(FILE, 'ARG BASE=node:22\nFROM ${BASE}')).toEqual([
      `${FILE}:2: \${BASE} — a base image named by an argument cannot be checked; write it out`,
    ])
  })
})

describe('the repository', () => {
  it('pins every action and every base image', () => {
    const paths = execFileSync(
      'git',
      [
        'ls-files',
        '-z',
        '--',
        '.github/workflows/*.yml',
        '.github/workflows/*.yaml',
        'Dockerfile',
        '**/Dockerfile',
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean)
    expect(paths).toContain('.github/workflows/release.yml')
    expect(paths).toContain('services/receipt-reader/Dockerfile')
    expect(pinProblems(paths.map((path) => ({ path, text: readFileSync(path, 'utf8') })))).toEqual(
      [],
    )
  })
})
