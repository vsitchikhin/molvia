// Refuses what CI runs or builds on by a pointer someone else can move (MOL-364): every `uses:` of a
// workflow or of an action of this repository is a full commit sha with the release it is in a comment —
// Dependabot moves the two together — and every image a Dockerfile takes from a registry, by `FROM`,
// `COPY --from` or `RUN --mount=…,from=`, carries its digest beside an exact tag. A tag of an action or an
// image is moved by whoever publishes it, and the next run takes what it points at then: the way secrets
// of CI leaked through `tj-actions` in 2025. GitHub refuses an action by tag itself once «Require actions
// to be pinned» is on, but that is a setting outside git, and nothing there holds a Dockerfile. And a
// directory with a Dockerfile is one Dependabot watches: a digest nobody moves is frozen for good.
//
// Whether the tag is the digest's is the registry's to know, never this check's: Docker pulls the digest
// and never reads the tag, so a tag changed by hand without its digest changes nothing that runs. Nor
// can it know that a sha is a commit of the action's own repository rather than of a fork.
//
// It holds the ordinary spelling, not a form built to slip past it: `uses:` as the key at the start of
// its line or after `- `, with its value on that line; an instruction's flags on its first line. Another
// spelling of YAML is past it, and GitHub's own setting refuses such an action at the run.
//
//   node bin/check-pins.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const FILES = [
  '.github/workflows/*.yml',
  '.github/workflows/*.yaml',
  '.github/actions/*/action.yml',
  '.github/actions/*/action.yaml',
  'Dockerfile',
  '**/Dockerfile',
]
const DEPENDABOT = '.github/dependabot.yml'

// A step's or a job's `uses:` and its value, quoted or not, with what follows it on the line.
const USES = /^[\t ]*(?:-[\t ]+)?uses:[\t ]*(['"]?)([^'"\s#]+)\1[\t ]*(.*)$/
const SHA = /^[^@\s]+@[0-9a-f]{40}$/
// A release, never a major alone: `# v7` beside a sha says no more than the tag did.
const VERSION_COMMENT = /^#[\t ]*v?\d+(?:\.\d+)+\b/
const DIGEST = /@sha256:[0-9a-f]{64}$/
// A tag that is a major alone, `22`, `2-alpine`, `v1` — a pointer each release moves. A codename such as
// `trixie-slim` passes: which tag is exact past this is review's.
const MAJOR_ONLY = /^v?\d+(?:[-_]|$)/

/** What is wrong with the `uses:` of one workflow or action, in sentences. */
export function workflowProblems(path, text) {
  const problems = []
  text.split('\n').forEach((line, index) => {
    const match = USES.exec(line)
    if (!match) return
    const [, , reference, rest] = match
    const where = `${path}:${String(index + 1)}`
    // A workflow or an action of this repository is this commit's own code, and its file is read here.
    if (reference.startsWith('./')) return
    if (!SHA.test(reference)) {
      problems.push(
        `${where}: ${reference} — pin it by the full commit sha, its release in a comment`,
      )
    } else if (!VERSION_COMMENT.test(rest.trim())) {
      problems.push(`${where}: ${reference} — name its release in a comment after it, # vX.Y.Z`)
    }
  })
  return problems
}

/** Why an image taken from a registry is not pinned, or null; a stage of the file is no image. */
function imageProblem(image, stages) {
  if (!image || image === 'scratch' || stages.has(image.toLowerCase()) || /^\d+$/.test(image)) {
    return null
  }
  if (image.includes('$')) {
    return `${image} — an image named by an argument cannot be checked; write it out`
  }
  const name = image.split('@')[0]
  const colon = name.lastIndexOf(':')
  const tag = colon > name.lastIndexOf('/') ? name.slice(colon + 1) : ''
  if (!tag || tag === 'latest' || MAJOR_ONLY.test(tag) || !DIGEST.test(image)) {
    return `${image} — pin it by an exact tag and its digest, image:tag@sha256:…`
  }
  return null
}

/** The images one line of a Dockerfile takes from elsewhere: `COPY --from`, `RUN --mount=…,from=`. */
function sourcesOf(instruction, flags) {
  if (instruction === 'COPY') {
    return flags.filter((flag) => flag.startsWith('--from=')).map((flag) => flag.slice(7))
  }
  if (instruction === 'RUN') {
    return flags
      .filter((flag) => flag.startsWith('--mount='))
      .flatMap((flag) => flag.slice(8).split(','))
      .filter((pair) => pair.startsWith('from='))
      .map((pair) => pair.slice(5))
  }
  return []
}

/** What is wrong with the images of one Dockerfile, in sentences. */
export function dockerfileProblems(path, text) {
  const problems = []
  const stages = new Set()
  text.split('\n').forEach((line, index) => {
    const words = line.trim().split(/\s+/)
    const instruction = words[0]?.toUpperCase()
    const where = `${path}:${String(index + 1)}`
    const flags = words.slice(1).filter((word) => word.startsWith('--'))
    const images =
      instruction === 'FROM'
        ? [words.slice(1).find((word) => !word.startsWith('--'))]
        : sourcesOf(instruction, flags)
    for (const image of images) {
      const problem = imageProblem(image, stages)
      if (problem) problems.push(`${where}: ${problem}`)
    }
    // A stage is named only after its own line: it cannot be its own base, and Docker takes that one
    // from the registry.
    if (instruction === 'FROM') {
      const [, as, stage] = words.slice(1).filter((word) => !word.startsWith('--'))
      if (as?.toUpperCase() === 'AS' && stage) stages.add(stage.toLowerCase())
    }
  })
  return problems
}

/** The directories the docker entry of `dependabot.yml` names, as it is written there. */
function watchedDirectories(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) =>
    /^[\t ]*-[\t ]+package-ecosystem:[\t ]*['"]?docker['"]?[\t ]*(?:#.*)?$/.test(line),
  )
  if (start < 0) return null
  const directories = new Set()
  for (const line of lines.slice(start + 1)) {
    if (/^[\t ]*-[\t ]+package-ecosystem:/.test(line)) break
    const match = /^[\t ]*(?:-|directory:)[\t ]*['"]?(\/[^'"\s#]*)['"]?[\t ]*(?:#.*)?$/.exec(line)
    if (match) directories.add(match[1].replace(/(.)\/+$/, '$1'))
  }
  return directories
}

/** A directory with a Dockerfile that the docker entry of Dependabot does not watch, in sentences. */
export function dependabotProblems(dockerfiles, text) {
  const watched = watchedDirectories(text)
  if (!watched) return [`${DEPENDABOT}: no docker entry — Dependabot moves no base image`]
  return dockerfiles
    .map((path) => `/${path.split('/').slice(0, -1).join('/')}`)
    .filter((directory) => !watched.has(directory))
    .map(
      (directory) =>
        `${DEPENDABOT}: ${directory} has a Dockerfile Dependabot does not watch — add it to the docker entry's directories`,
    )
}

const isDockerfile = (path) => path.split('/').pop() === 'Dockerfile'

/** Every problem of the files given, each a path and its text. */
export function pinProblems(files) {
  return files.flatMap(({ path, text }) =>
    isDockerfile(path) ? dockerfileProblems(path, text) : workflowProblems(path, text),
  )
}

/** Every problem of the repository as git tracks it — what `npm run lint` runs. */
export function repositoryProblems() {
  const paths = execFileSync('git', ['ls-files', '-z', '--', ...FILES], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
  return [
    ...pinProblems(paths.map((path) => ({ path, text: readFileSync(path, 'utf8') }))),
    ...dependabotProblems(paths.filter(isDockerfile), readFileSync(DEPENDABOT, 'utf8')),
  ]
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const problems = repositoryProblems()
  if (problems.length > 0) {
    console.error('pins (MOL-364):')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
}
