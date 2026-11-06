import { describe, expect, it } from 'vitest'
import {
  dependabotProblems,
  dockerfileProblems,
  pinProblems,
  repositoryProblems,
  workflowProblems,
} from './check-pins.mjs'

const SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1'
const DIGEST = `sha256:${'0e17'.repeat(16)}`
const WORKFLOW = '.github/workflows/ci.yml'

const steps = (...lines: string[]): string => `jobs:\n  check:\n    steps:\n${lines.join('\n')}\n`
const unpinned = (where: string, reference: string): string =>
  `${where}: ${reference} — pin it by the full commit sha, its release in a comment`
const unnamed = (where: string, reference: string): string =>
  `${where}: ${reference} — name its release in a comment after it, # vX.Y.Z`

describe('workflowProblems', () => {
  it('is quiet on a full sha with its release in a comment, quoted or not, a job or a step', () => {
    const text = [
      steps(
        `      - uses: actions/checkout@${SHA} # v7.0.1`,
        `      - name: cache`,
        `        uses: 'actions/cache@${SHA}' #v6.1`,
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
      unpinned(`${WORKFLOW}:4`, 'actions/checkout@v7'),
      unpinned(`${WORKFLOW}:5`, 'docker/login-action@master'),
      unpinned(`${WORKFLOW}:6`, `actions/cache@${SHA.slice(0, 7)}`),
    ])
  })

  it('refuses a sha with no release named, a word for one, or a major alone', () => {
    const text = steps(
      `      - uses: actions/checkout@${SHA}`,
      `      - uses: actions/checkout@${SHA} # checkout`,
      `      - uses: actions/checkout@${SHA} # v7`,
      `      - uses: actions/checkout@${SHA} #v6`,
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual(
      [4, 5, 6, 7].map((line) => unnamed(`${WORKFLOW}:${String(line)}`, `actions/checkout@${SHA}`)),
    )
  })

  it('refuses a sha in capitals: it takes only the form Dependabot writes', () => {
    expect(
      workflowProblems(WORKFLOW, steps(`      - uses: a/b@${SHA.toUpperCase()} # v1.0`)),
    ).toHaveLength(1)
  })

  it('refuses a docker:// image as an action not pinned by its sha', () => {
    expect(
      workflowProblems(WORKFLOW, steps(`      - uses: docker://alpine:3.22@${DIGEST}`)),
    ).toEqual([unpinned(`${WORKFLOW}:4`, `docker://alpine:3.22@${DIGEST}`)])
  })

  it('leaves a local action and a commented-out line alone', () => {
    const text = steps(
      '      - uses: ./.github/actions/setup',
      '      # - uses: actions/checkout@v7',
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual([])
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
      `FROM debian:trixie-slim@${DIGEST}`,
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

  it('refuses latest and a major alone even beside their digest', () => {
    const images = [
      `node:latest@${DIGEST}`,
      `node:22@${DIGEST}`,
      `caddy:2-alpine@${DIGEST}`,
      `x/y:v1@${DIGEST}`,
    ]
    expect(dockerfileProblems(FILE, images.map((image) => `FROM ${image}`).join('\n'))).toEqual(
      images.map((image, index) => told(index + 1, image)),
    )
  })

  it('takes a stage only after its own line — a stage named as its image, or below, is still an image', () => {
    const text = [
      'FROM runtime',
      'FROM caddy AS caddy',
      'FROM node AS Node',
      `FROM node:22.23.4-alpine@${DIGEST} AS runtime`,
    ]
    expect(dockerfileProblems(FILE, text.join('\n'))).toEqual([
      told(1, 'runtime'),
      told(2, 'caddy'),
      told(3, 'node'),
    ])
  })

  it('reads the images COPY --from and RUN --mount take, and leaves the stages they name alone', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST} AS build`,
      'COPY --from=build /repo/dist /srv',
      'COPY --from=0 /a /b',
      `COPY --chown=1:1 --from=busybox:1.37.0@${DIGEST} /bin/busybox /bb`,
      'COPY --from=busybox:latest /bin/busybox /bb',
      'RUN --mount=type=bind,from=busybox,target=/m ls /m',
      'RUN --mount=type=cache,target=/root/.npm --mount=type=bind,from=build,target=/b npm ci',
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([told(5, 'busybox:latest'), told(6, 'busybox')])
  })

  it('refuses an image named by an argument, which it cannot read', () => {
    expect(dockerfileProblems(FILE, 'ARG BASE=node:22\nFROM ${BASE}')).toEqual([
      `${FILE}:2: \${BASE} — an image named by an argument cannot be checked; write it out`,
    ])
  })
})

describe('pinProblems', () => {
  it('reads an action of the repository as a workflow', () => {
    const action = 'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n'
    expect(pinProblems([{ path: '.github/actions/setup/action.yml', text: action }])).toEqual([
      unpinned('.github/actions/setup/action.yml:4', 'actions/checkout@v7'),
    ])
  })
})

describe('dependabotProblems', () => {
  const entry = (...directories: string[]): string =>
    [
      'updates:',
      '  - package-ecosystem: npm',
      '    directory: /backend',
      '  - package-ecosystem: docker',
      '    directories:',
      ...directories.map((directory) => `      - ${directory}`),
      '    schedule:',
      '      interval: weekly',
      '  - package-ecosystem: github-actions',
      '    directory: /deploy/loki',
    ].join('\n')

  it('is quiet when every directory with a Dockerfile is watched, a trailing slash or quotes aside', () => {
    expect(
      dependabotProblems(
        ['Dockerfile', 'frontend/Dockerfile', 'deploy/grafana/Dockerfile'],
        entry('/', '/frontend/', "'/deploy/grafana'"),
      ),
    ).toEqual([])
  })

  it('names a directory with a Dockerfile the docker entry does not watch — another entry does not count', () => {
    expect(
      dependabotProblems(
        ['frontend/Dockerfile', 'deploy/loki/Dockerfile', 'backend/Dockerfile'],
        entry('/frontend'),
      ),
    ).toEqual([
      ".github/dependabot.yml: /deploy/loki has a Dockerfile Dependabot does not watch — add it to the docker entry's directories",
      ".github/dependabot.yml: /backend has a Dockerfile Dependabot does not watch — add it to the docker entry's directories",
    ])
  })

  it('refuses a file with no docker entry', () => {
    expect(
      dependabotProblems(['frontend/Dockerfile'], 'updates:\n  - package-ecosystem: npm\n'),
    ).toEqual(['.github/dependabot.yml: no docker entry — Dependabot moves no base image'])
  })
})

describe('the repository', () => {
  it('pins every action and every image, and Dependabot watches every Dockerfile', () => {
    expect(repositoryProblems()).toEqual([])
  })
})
