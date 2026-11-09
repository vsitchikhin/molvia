import { describe, expect, it } from 'vitest'
import {
  checkedPaths,
  imageTakers,
  dependabotProblems,
  dockerfileProblems,
  pinProblems,
  repositoryProblems,
  lastStageProblems,
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

  it('reads a docker:// step as an image, pinned by its tag and digest', () => {
    const text = steps(
      `      - uses: docker://alpine:3.24.4@${DIGEST}`,
      '      - uses: docker://alpine:3.24',
    )
    expect(workflowProblems(WORKFLOW, text)).toEqual([
      `${WORKFLOW}:5: alpine:3.24 — pin it by an exact tag and its digest, image:1.2.3@sha256:…`,
    ])
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
    `${FILE}:${String(line)}: ${image} — pin it by an exact tag and its digest, image:1.2.3@sha256:…`

  it('is quiet on a tag with its digest, a stage of the file, scratch and a platform flag', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST} AS build`,
      'RUN true',
      `from --platform=linux/amd64 ghcr.io/google/cadvisor:v0.60.6@${DIGEST} as Tools`,
      `FROM debian:trixie-20261104-slim@${DIGEST}`,
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

  it('refuses every tag but a version of three numbers or the day of a snapshot, even beside its digest', () => {
    const images = [
      `node:latest@${DIGEST}`,
      `node:22@${DIGEST}`,
      `caddy:2-alpine@${DIGEST}`,
      `x/y:v1@${DIGEST}`,
      `caddy:2.11-alpine@${DIGEST}`,
      `node:lts-alpine@${DIGEST}`,
      `node:alpine@${DIGEST}`,
      `debian:trixie-slim@${DIGEST}`,
      `debian:2026110-slim@${DIGEST}`,
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

  it('joins the lines of an instruction at the backslash, a comment inside left out, and names its first line', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST} AS build`,
      'RUN --mount=type=cache,target=/var/cache \\',
      '    # the binary the build needs',
      '    --mount=type=bind,from=busybox:latest,target=/m \\',
      '    ls /m/bin/busybox',
      'COPY --from=build /a /b',
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([told(2, 'busybox:latest')])
  })

  it('reads a file of CRLF as one of LF', () => {
    const text = [
      '# syntax=docker/dockerfile:1',
      `FROM node:22.23.4-alpine@${DIGEST}`,
      'RUN --mount=type=cache,target=/c \\',
      '    --mount=type=bind,from=busybox:latest,target=/m \\',
      '    ls /m',
    ].join('\n')
    expect(dockerfileProblems(FILE, text.replaceAll('\n', '\r\n'))).toEqual(
      dockerfileProblems(FILE, text),
    )
    expect(dockerfileProblems(FILE, text)).toEqual([
      told(1, 'docker/dockerfile:1'),
      told(3, 'busybox:latest'),
    ])
  })

  it('never takes a comment for an instruction, nor goes on with one, a backslash at its end or not', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST}`,
      '# RUN apt-get update && \\',
      '#     apt-get install -y curl',
      '',
      'FROM busybox AS tools',
      '# copied from C:\\',
      'COPY --from=busybox:latest /bin/busybox /bb',
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([told(5, 'busybox'), told(7, 'busybox:latest')])
  })

  it('keeps an instruction whole across a blank line inside it, as BuildKit does', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST}`,
      'RUN --mount=type=cache,target=/c \\',
      '',
      '    --mount=type=bind,from=busybox:latest,target=/m \\',
      '    ls /m',
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([told(2, 'busybox:latest')])
  })

  it('reads the image a syntax directive hands the file to, only where directives stand', () => {
    const pinned = `docker/dockerfile:1.17.1@${DIGEST}`
    expect(dockerfileProblems(FILE, `# syntax=${pinned}\n# escape=\\\nFROM scratch`)).toEqual([])
    expect(dockerfileProblems(FILE, '#syntax=docker/dockerfile:1\nFROM scratch')).toEqual([
      told(1, 'docker/dockerfile:1'),
    ])
    expect(
      dockerfileProblems(
        FILE,
        '# check=error=true\n# SYNTAX = docker/dockerfile:1.7-labs\nFROM scratch',
      ),
    ).toEqual([told(2, 'docker/dockerfile:1.7-labs')])
    // As BuildKit reads them: a comment after the value, a byte order mark, a first line of `#!`.
    expect(
      dockerfileProblems(
        FILE,
        '# syntax=docker/dockerfile:1  # the frontend, for heredocs\nFROM scratch',
      ),
    ).toEqual([told(1, 'docker/dockerfile:1')])
    expect(dockerfileProblems(FILE, '\uFEFF# syntax=docker/dockerfile:1\nFROM scratch')).toEqual([
      told(1, 'docker/dockerfile:1'),
    ])
    expect(
      dockerfileProblems(
        FILE,
        '#!/usr/bin/env -S docker build -f\n# syntax=docker/dockerfile:1\nFROM scratch',
      ),
    ).toEqual([told(2, 'docker/dockerfile:1')])
    // The value's first word ends at any space, a tab before a comment too.
    expect(dockerfileProblems(FILE, `# syntax=${pinned}\t# the frontend\nFROM scratch`)).toEqual([])
    // A byte order mark is taken off once, for the instructions too: a comment there goes on with nothing.
    const commented =
      '\uFEFF# RUN apt-get update && \\\n#     apt-get install -y curl\n\nFROM busybox AS tools'
    expect(dockerfileProblems(FILE, commented)).toEqual([told(4, 'busybox')])
    expect(imageTakers([{ path: FILE, text: commented }])).toEqual([FILE])
    // A key BuildKit does not know ends the directives, as does a comment: no directive after either.
    expect(
      dockerfileProblems(FILE, '# foo1=bar\n# syntax=docker/dockerfile:1\nFROM scratch'),
    ).toEqual([])
    expect(
      dockerfileProblems(FILE, '# a note\n# syntax=docker/dockerfile:1\nFROM scratch'),
    ).toEqual([])
  })

  it('takes off the quotes BuildKit takes off, and reads the key of a mount in any case', () => {
    const pinned = `busybox:1.37.0@${DIGEST}`
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST}`,
      `COPY --from="${pinned}" /bin/busybox /bb`,
      `RUN --mount=type=bind,"from=${pinned}",target=/m ls /m`,
      'RUN --mount=type=bind,FROM=busybox:latest,target=/m ls /m',
      'RUN --mount=type=bind,"from=busybox:latest",target=/m ls /m',
      "COPY --from='busybox:latest' /bin/busybox /bb",
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([
      told(4, 'busybox:latest'),
      told(5, 'busybox:latest'),
      told(6, 'busybox:latest'),
    ])
  })

  it('keeps a space or a comma inside quotes in its flag, as BuildKit does', () => {
    const text = [
      `FROM node:22.23.4-alpine@${DIGEST}`,
      'RUN --mount=type=bind,target="/opt/tool kit",from=busybox:latest ls "/opt/tool kit"',
      'RUN --mount=type=bind,target="/a,b",from=busybox:latest ls /a',
      `RUN --mount=type=bind,target="/opt/tool kit",from=busybox:1.37.0@${DIGEST} ls`,
    ].join('\n')
    expect(dockerfileProblems(FILE, text)).toEqual([
      told(2, 'busybox:latest'),
      told(3, 'busybox:latest'),
    ])
  })

  it('refuses an image named by an argument, which it cannot read', () => {
    expect(dockerfileProblems(FILE, 'ARG BASE=node:22\nFROM ${BASE}')).toEqual([
      `${FILE}:2: \${BASE} — an image named by an argument cannot be checked; write it out`,
    ])
  })
})

describe('pinProblems', () => {
  it('reads an action of the repository as a workflow, wherever it lives', () => {
    const action = 'runs:\n  using: composite\n  steps:\n    - uses: actions/checkout@v7\n'
    expect(pinProblems([{ path: 'tools/setup/action.yml', text: action }])).toEqual([
      unpinned('tools/setup/action.yml:4', 'actions/checkout@v7'),
    ])
  })

  it('reads a workflow or an action as one, whatever word its name holds', () => {
    const text = steps('      - uses: actions/checkout@v7')
    for (const path of [
      '.github/workflows/lint-dockerfiles.yml',
      '.github/workflows/Dockerfile.yml',
      '.github/workflows/containerfile-build.yaml',
    ]) {
      expect(checkedPaths([path])).toEqual([path])
      expect(pinProblems([{ path, text }])).toEqual([unpinned(`${path}:4`, 'actions/checkout@v7')])
    }
  })

  it('reads the image of a Docker action, its own Dockerfile apart', () => {
    const action = (image: string): string => `runs:\n  using: docker\n  image: ${image}\n`
    const path = '.github/actions/scan/action.yml'
    expect(pinProblems([{ path, text: action("'docker://alpine:latest'") }])).toEqual([
      `${path}:3: alpine:latest — pin it by an exact tag and its digest, image:1.2.3@sha256:…`,
    ])
    expect(pinProblems([{ path, text: action(`docker://alpine:3.24.4@${DIGEST}`) }])).toEqual([])
    expect(pinProblems([{ path, text: action('Dockerfile') }])).toEqual([])
  })

  it('leaves the image of a container or a service of a workflow alone — not watched here', () => {
    const text =
      'jobs:\n  e2e:\n    container:\n      image: mcr.microsoft.com/playwright:v1.64.1-noble\n'
    expect(pinProblems([{ path: WORKFLOW, text }])).toEqual([])
  })

  it('reads a Dockerfile by any of its names, a workflow and an action — the paths lint reads', () => {
    const dockerfiles = [
      'Dockerfile',
      'prod.Dockerfile',
      'Containerfile.prod',
      'a/Containerfile.prod',
      'x/Dockerfile.prod',
      'x/prod.Dockerfile',
      'x/Containerfile',
      'x/dockerfile',
      'x/prod.dockerfile',
      'x/containerfile',
      'x/Dockerfile-prod',
      'x/Dockerfile_prod',
      'x/prod-Dockerfile',
    ]
    const yamls = [
      '.github/workflows/ci.yml',
      '.github/workflows/watch.yaml',
      'action.yml',
      'tools/setup/action.yaml',
    ]
    const left = ['README.md', '.github/workflows/sub/x.yml', 'x/my-action.yml']
    expect(checkedPaths([...dockerfiles, ...yamls, ...left])).toEqual([...dockerfiles, ...yamls])
    // A file of another kind by its extension, or the word only inside another word, is no Dockerfile.
    expect(
      checkedPaths([
        'docs/Dockerfile.md',
        'docs/dockerfile-guide.md',
        'x/Dockerfile.dockerignore',
        'services/receipt-reader/test_dockerfile.py',
        'bin/check-dockerfile.mjs',
        'x/mydockerfiles',
      ]),
    ).toEqual([])
    for (const path of dockerfiles) {
      expect(pinProblems([{ path, text: 'FROM node:22' }])).toHaveLength(1)
    }
  })
})

describe('imageTakers', () => {
  it('names the Dockerfiles that take an image, never a note or an ignore file so named', () => {
    expect(
      imageTakers([
        { path: 'x/Dockerfile', text: `# base\r\nFROM node:22.23.4-alpine@${DIGEST}\r\n` },
        { path: 'docs/Dockerfile.md', text: '# How the image is built\n\nSee `x/Dockerfile`.\n' },
        { path: 'x/Dockerfile.dockerignore', text: 'node_modules\n' },
        { path: 'y/Dockerfile', text: '# FROM node:22\n' },
        { path: '.github/workflows/ci.yml', text: 'from: x\n' },
        { path: '.github/workflows/dockerfile-lint.yml', text: 'FROM node:22\n' },
        { path: 'docs/dockerfile-guide.md', text: '```dockerfile\nFROM node:22\n```\n' },
      ]),
    ).toEqual(['x/Dockerfile'])
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

  it('refuses a pattern of directories it cannot read, rather than guess what it means', () => {
    expect(
      dependabotProblems(['deploy/grafana/Dockerfile'], entry("'/deploy/*'", '/deploy/grafana')),
    ).toEqual([
      '.github/dependabot.yml: /deploy/* — a pattern this check cannot read; list the directories it means',
    ])
  })

  it('refuses a file with no docker entry', () => {
    expect(
      dependabotProblems(['frontend/Dockerfile'], 'updates:\n  - package-ecosystem: npm\n'),
    ).toEqual(['.github/dependabot.yml: no docker entry — Dependabot moves no base image'])
  })
})

describe('lastStageProblems', () => {
  const FILE = 'deploy/victoria/Dockerfile'
  const at = (line: number): string => `${FILE}:${String(line)}`
  const noUser = (line: number): string =>
    `${at(line)}: the last stage names no user — the base's is not taken; USER <name or uid>`
  const root = (line: number, user: string): string =>
    `${at(line)}: USER ${user} — root, by its user or its group; name another`
  const unnamed = (line: number): string =>
    `${at(line)}: the last stage is not named runtime, the stage the release builds afresh (no-cache-filters) — FROM … AS runtime`

  it('is quiet on a last stage runtime that names a user by its name or number, a group beside it or not', () => {
    for (const user of ['caddy', 'node', '472', '65534:65534', '"nobody"', '10', '1000:472']) {
      const text = [
        'FROM node AS build',
        'RUN true',
        'FROM caddy as Runtime',
        'RUN true',
        `user ${user}`,
      ]
      expect(lastStageProblems(FILE, text.join('\n')), user).toEqual([])
    }
  })

  it('refuses a last stage not named runtime — the one stage the release builds afresh', () => {
    expect(lastStageProblems(FILE, 'FROM caddy\nUSER caddy')).toEqual([unnamed(1)])
    expect(
      lastStageProblems(FILE, 'FROM node AS runtime\nUSER node\nFROM runtime AS final\nUSER node'),
    ).toEqual([unnamed(3)])
  })

  it('refuses a last stage that names no user, by the line of its FROM — even one built from a stage that names one: only its own USER counts', () => {
    expect(lastStageProblems(FILE, 'FROM victoria AS runtime\nCOPY a b\n')).toEqual([noUser(1)])
    const text = 'FROM node AS build\nUSER node\nFROM build AS runtime\nCOPY a b'
    expect(lastStageProblems(FILE, text)).toEqual([noUser(3)])
  })

  it('refuses root by its name or by uid 0 in any spelling Docker reads as a number, and the group root', () => {
    for (const user of [
      'root',
      '0',
      '00',
      '+0',
      '-0',
      '0000:0000',
      '0:0',
      'root:472',
      'caddy:0',
      'caddy:root',
      '472:00',
    ]) {
      expect(lastStageProblems(FILE, `FROM caddy AS runtime\nUSER ${user}`), user).toEqual([
        root(1, user),
      ])
    }
    const later = 'FROM grafana AS runtime\nUSER 472\nUSER root\nRUN true'
    expect(lastStageProblems(FILE, later)).toEqual([root(1, 'root')])
  })

  it('takes the last USER of the stage — root for a RUN and back is a user', () => {
    const text = 'FROM grafana AS runtime\nUSER root\nRUN apk upgrade\nUSER 472'
    expect(lastStageProblems(FILE, text)).toEqual([])
  })

  it('reads no instruction in the body of a heredoc — a config line `user nginx;` is no USER, a `FROM` of SQL no stage', () => {
    const config = [
      'FROM caddy AS runtime',
      'COPY <<EOF /etc/nginx/nginx.conf',
      'user nginx;',
      'worker_processes auto;',
      'EOF',
    ].join('\n')
    expect(lastStageProblems(FILE, config)).toEqual([noUser(1)])
    const sql = [
      'FROM postgres AS runtime',
      'USER postgres',
      "RUN <<-'SQL' psql",
      '\tSELECT 1',
      '\tFROM pg_class;',
      '\tSQL',
      'COPY <<A /a <<"B" /b',
      'USER root',
      'A',
      'FROM x',
      'B',
    ].join('\n')
    expect(lastStageProblems(FILE, sql)).toEqual([])
  })

  it('refuses a user named by an argument, and is quiet on a file with no FROM', () => {
    expect(lastStageProblems(FILE, 'ARG WHO=caddy\nFROM caddy AS runtime\nUSER ${WHO}')).toEqual([
      `${at(2)}: USER \${WHO} — named by an argument, which this check cannot read`,
    ])
    expect(lastStageProblems(FILE, '# a note\n')).toEqual([])
  })
})

describe('dockerfileProblems and a heredoc', () => {
  it('takes a heredoc only from a whole word, as BuildKit does — never one inside a word, a quote or arithmetic', () => {
    for (const line of [
      'RUN echo $((1<<SHIFT))',
      'RUN echo "see <<EOF in the docs"',
      "RUN echo '<<EOF'",
      'RUN cat<<EOF',
      'ENV A=<<EOF',
    ]) {
      const text = `${line}\nFROM alpine:latest AS runtime\nUSER root`
      expect(dockerfileProblems('frontend/Dockerfile', text), line).toEqual([
        'frontend/Dockerfile:2: alpine:latest — pin it by an exact tag and its digest, image:1.2.3@sha256:…',
      ])
      expect(lastStageProblems('frontend/Dockerfile', text), line).toEqual([
        'frontend/Dockerfile:2: USER root — root, by its user or its group; name another',
      ])
    }
  })

  it('ends a heredoc at its whole word, a dash and quotes in it, a descriptor before it', () => {
    for (const [line, end] of [
      ['COPY <<END-CONF /tmp/x.conf', 'END-CONF'],
      ['RUN 3<<"MY.WORD" cat', 'MY.WORD'],
    ] as const) {
      const text = `${line}\nFROM caddy:latest\n${end}\nFROM alpine:latest AS runtime\nUSER caddy`
      expect(dockerfileProblems('frontend/Dockerfile', text), line).toEqual([
        'frontend/Dockerfile:4: alpine:latest — pin it by an exact tag and its digest, image:1.2.3@sha256:…',
      ])
    }
  })

  it('takes no image from the body of a heredoc', () => {
    const text = `FROM caddy:2.11.9-alpine@${DIGEST} AS runtime\nRUN <<EOF\nFROM caddy:latest\nEOF\nUSER caddy`
    expect(dockerfileProblems('frontend/Dockerfile', text)).toEqual([])
  })
})

describe('the repository', () => {
  it('pins every action and every image, Dependabot watches every Dockerfile, and every last stage is runtime with a user', () => {
    expect(repositoryProblems()).toEqual([])
  })
})
