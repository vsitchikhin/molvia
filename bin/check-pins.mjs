// Refuses what CI runs or builds on by a pointer someone else can move (MOL-364): every `uses:` of a
// workflow is a full commit sha with the release it is in a comment — Dependabot moves the two together —
// and every base image of a Dockerfile carries its digest beside its tag. A tag of an action or an image
// is moved by whoever publishes it, and the next run takes what it points at then: the way secrets of CI
// leaked through `tj-actions` in 2025. GitHub refuses an action by tag itself once «Require actions to be
// pinned» is on, but that is a setting outside git, and nothing there holds a Dockerfile.
//
// Whether the tag is the digest's is the registry's to know, never this check's: Docker pulls the digest
// and never reads the tag, so a tag changed by hand without its digest changes nothing that runs.
//
//   node bin/check-pins.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

const FILES = ['.github/workflows/*.yml', '.github/workflows/*.yaml', 'Dockerfile', '**/Dockerfile']

// A step's or a job's `uses:` and its value, quoted or not, with what follows it on the line.
const USES = /^[\t ]*(?:-[\t ]+)?uses:[\t ]*(['"]?)([^'"\s#]+)\1[\t ]*(.*)$/
const SHA = /^[^@\s]+@[0-9a-f]{40}$/
const VERSION_COMMENT = /^#[\t ]*v?\d+(?:\.\d+)*\b/
const DIGEST = /@sha256:[0-9a-f]{64}$/

/** What is wrong with the `uses:` of one workflow, in sentences. */
export function workflowProblems(path, text) {
  const problems = []
  text.split('\n').forEach((line, index) => {
    const match = USES.exec(line)
    if (!match) return
    const [, , reference, rest] = match
    const where = `${path}:${index + 1}`
    // An action of this repository is this commit's own code.
    if (reference.startsWith('./')) return
    if (reference.startsWith('docker://')) {
      if (!DIGEST.test(reference))
        problems.push(`${where}: ${reference} — pin the image by its digest`)
      return
    }
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

/** What is wrong with the `FROM` lines of one Dockerfile, in sentences. */
export function dockerfileProblems(path, text) {
  const problems = []
  const stages = new Set()
  text.split('\n').forEach((line, index) => {
    const words = line.trim().split(/\s+/)
    if (words[0]?.toUpperCase() !== 'FROM') return
    const [image, as, stage] = words.slice(1).filter((word) => !word.startsWith('--'))
    const where = `${path}:${index + 1}`
    if (as?.toUpperCase() === 'AS' && stage) stages.add(stage.toLowerCase())
    if (!image || image === 'scratch' || stages.has(image.toLowerCase())) return
    if (image.includes('$')) {
      problems.push(
        `${where}: ${image} — a base image named by an argument cannot be checked; write it out`,
      )
      return
    }
    const name = image.split('@')[0]
    const tagged = name.lastIndexOf(':') > name.lastIndexOf('/')
    if (!tagged || !DIGEST.test(image)) {
      problems.push(
        `${where}: ${image} — pin it by an exact tag and its digest, image:tag@sha256:…`,
      )
    }
  })
  return problems
}

/** Every problem of the files given, each a path and its text. */
export function pinProblems(files) {
  return files.flatMap(({ path, text }) =>
    path.startsWith('.github/workflows/')
      ? workflowProblems(path, text)
      : dockerfileProblems(path, text),
  )
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const paths = execFileSync('git', ['ls-files', '-z', '--', ...FILES], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
  const problems = pinProblems(paths.map((path) => ({ path, text: readFileSync(path, 'utf8') })))
  if (problems.length > 0) {
    console.error('pins (MOL-364):')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
}
