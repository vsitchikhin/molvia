// Refuses an action or an image CI runs or builds on by a pointer someone else can move (MOL-364):
// every `uses:` of a workflow or of an action of this repository is a full commit sha with the
// release it is in a comment — Dependabot moves the two together — and every image taken from a
// registry carries its digest beside an exact tag: a Dockerfile's `# syntax=`, `FROM`,
// `COPY --from` and `RUN --mount=…,from=`, an action's `image: docker://…`. A tag of an action or
// an image is moved by whoever publishes it, and the next run takes what it points at then: the way
// secrets of CI leaked through `tj-actions` in 2025. GitHub refuses an action by tag itself once
// «Require actions to be pinned» is on, but that is a setting outside git, and nothing there holds
// a Dockerfile. And a directory with a Dockerfile is one Dependabot watches: a digest nobody moves
// is frozen for good.
//
// Whether the tag is the digest's is the registry's to know, never this check's: Docker pulls the
// digest and never reads the tag, so a tag changed by hand without its digest changes nothing that
// runs. Nor can it know that a sha is a commit of the action's own repository rather than of a
// fork.
//
// It holds the ordinary spelling, not a form built to slip past it: `uses:` and `image:` as the key
// at the start of their line or after `- `, with the value on that line; a Dockerfile's lines
// joined at `\`, the default escape, a blank or a comment line inside dropped, the ends of lines LF
// or CRLF; the directories of Dependabot written out. Another spelling of YAML is past it, and
// GitHub's own setting refuses such an action at the run. A file `ADD` fetches by a URL or from
// git, and whatever `RUN` downloads, is no image and is not read here: its pinned forms
// (`ADD --checksum=…`, `#<sha>`) are review's.
//
// And the last stage of every Dockerfile (MOL-365) is named `runtime` — the one stage `release.yml`
// builds afresh (`no-cache-filters`), so its upgrade of the distribution runs at every release —
// and names its user with `USER`: neither root by name nor uid 0 in any spelling Docker reads as a
// number (`00`, `+0`, `-0`), nor the group root written beside it (`caddy:0`) — the group a user
// without one takes from the image's `/etc/passwd` is the image's (Grafana's 472 is in group 0, by
// its authors). The base's user is not taken: a base moved by Dependabot may change it, and an
// image built without one ran as root in silence (Caddy and VictoriaMetrics, audit MOL-287). A user
// named by an argument is refused, as an image is: the check cannot read it.
//
//   node bin/check-pins.mjs

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'

// What is read, by its path — one rule, for `npm run lint` and the test alike.
const isWorkflow = (path) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)
const isAction = (path) => /^action\.ya?ml$/.test(path.split('/').pop() ?? '')
// A Dockerfile by its name: Dependabot's word — `dockerfile` or `containerfile`, in any case —
// bounded by the name's ends, `.`, `-` or `_` (`Dockerfile.prod`, `prod-Dockerfile`); a file of a
// kind `OTHER_KIND` lists by its extension is not one (`test_dockerfile.py`, a note `.md`), and a
// kind it does not list is read. Dependabot reads only the directories it is given; this reads the
// whole repository.
const OTHER_KIND =
  /\.(?:md|markdown|txt|rst|adoc|py|[cm]?[jt]sx?|sh|bash|zsh|json|ya?ml|toml|ini|cfg|conf|html?|s?css|dockerignore)$/i
const isDockerfile = (path) => {
  const name = path.split('/').pop() ?? ''
  return /(?:^|[._-])(?:dockerfile|containerfile)(?:[._-]|$)/i.test(name) && !OTHER_KIND.test(name)
}
// A workflow or an action is read as one first, whatever word its name holds.
const isYaml = (path) => isWorkflow(path) || isAction(path)

/** The paths of those given that the check reads. */
export const checkedPaths = (paths) => paths.filter((path) => isYaml(path) || isDockerfile(path))
const DEPENDABOT = '.github/dependabot.yml'

// The key of a step, a job or an action and its value, quoted or not, with what follows it on the
// line.
const keyOf = (key) =>
  new RegExp(`^[\\t ]*(?:-[\\t ]+)?${key}:[\\t ]*(['"]?)([^'"\\s#]+)\\1[\\t ]*(.*)$`)
const USES = keyOf('uses')
const IMAGE = keyOf('image')
const SHA = /^[^@\s]+@[0-9a-f]{40}$/
// A release, never a major alone: `# v7` beside a sha says no more than the tag did.
const VERSION_COMMENT = /^#[\t ]*v?\d+(?:\.\d+)+\b/
const DIGEST = /@sha256:[0-9a-f]{64}$/
// An exact tag, by a closed rule rather than a list of the floating ones: a version of three
// numbers at its start (`22.23.4-alpine`, `v1.153.0`), or the day of a snapshot
// (`trixie-20261104-slim`). Anything else — `latest`, `22`, `2.11-alpine`, `lts-alpine`,
// `trixie-slim` — is moved by the next release.
const EXACT_TAG = /^v?\d+\.\d+\.\d+(?:[-_.+]|$)|(?:^|[-_.])\d{8}(?:[-_.]|$)/
// BuildKit's own (`frontend/dockerfile/parser/directives.go`): the value runs to the end of the
// line, and a key it does not know ends the directives.
const DIRECTIVE = /^#\s*([a-zA-Z][a-zA-Z0-9]*)\s*=\s*(.+?)\s*$/
const DIRECTIVE_KEYS = new Set(['syntax', 'escape', 'check'])

/** Why an image taken from a registry is not pinned, or null; a stage of the file is no image. */
function imageProblem(image, stages = new Set()) {
  if (!image || image === 'scratch' || stages.has(image.toLowerCase()) || /^\d+$/.test(image)) {
    return null
  }
  if (image.includes('$')) {
    return `${image} — an image named by an argument cannot be checked; write it out`
  }
  const name = image.split('@')[0]
  const colon = name.lastIndexOf(':')
  const tag = colon > name.lastIndexOf('/') ? name.slice(colon + 1) : ''
  if (!EXACT_TAG.test(tag) || !DIGEST.test(image)) {
    return `${image} — pin it by an exact tag and its digest, image:1.2.3@sha256:…`
  }
  return null
}

/** What is wrong with the `uses:` of one workflow or action, and the image of an action, in sentences. */
export function workflowProblems(path, text) {
  const problems = []
  const action = !isWorkflow(path)
  text.split(/\r?\n/).forEach((line, index) => {
    const where = `${path}:${String(index + 1)}`
    // The image a Docker action runs. A workflow's `image:` is a container or a service's, not
    // watched here.
    const image = action ? IMAGE.exec(line)?.[2] : undefined
    if (image?.startsWith('docker://')) {
      const problem = imageProblem(image.slice('docker://'.length))
      if (problem) problems.push(`${where}: ${problem}`)
      return
    }
    const match = USES.exec(line)
    if (!match) return
    const [, , reference, rest] = match
    // A workflow or an action of this repository is this commit's own code, and its file is read
    // here.
    if (reference.startsWith('./')) return
    // An image as a step is an image, pinned as any other.
    if (reference.startsWith('docker://')) {
      const problem = imageProblem(reference.slice('docker://'.length))
      if (problem) problems.push(`${where}: ${problem}`)
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

/** The lines of a Dockerfile, LF or CRLF, with a byte order mark taken off the first — once, before
 * the directives and the instructions alike, as BuildKit takes it off. */
const linesOf = (text) => text.replace(/^\uFEFF/, '').split(/\r?\n/)

// A heredoc of BuildKit (`heredocsFromLine`): a word of the instruction, split outside quotes, that is
// the whole of `<<WORD`, `<<-WORD`, `<<"WORD"`, `2<<WORD` — never `<<` inside a word or a quote
// (`'<<EOF'`, `cat<<EOF`, `$((1<<N))`, round 2, №6 and Р2-А1). The word is what follows, read as the
// shell reads a word (`shellWord`): `<<\EOF` and `<<E"O"F` end at `EOF` (adversarial Р3-А1).
const HEREDOC = /^\d*<<(-?)([^<]+)$/
const TAKES_HEREDOCS = new Set(['RUN', 'COPY', 'ADD'])

/** A word as the shell reads it: quotes taken off, a backslash outside single quotes escaping the next
 * character — inside double quotes only `"`, `\`, `$` and the backtick. */
function shellWord(word) {
  let out = ''
  let quote = null
  for (let i = 0; i < word.length; i += 1) {
    const char = word[i]
    if (quote === "'") {
      if (char === "'") quote = null
      else out += char
    } else if (char === '\\' && i + 1 < word.length && (!quote || '"\\$`'.includes(word[i + 1]))) {
      i += 1
      out += word[i]
    } else if (char === quote) {
      quote = null
    } else if (!quote && (char === '"' || char === "'")) {
      quote = char
    } else {
      out += char
    }
  }
  return out
}

/** One reading of the instructions; the heredocs begun on the lines of `plain` are not taken. */
function scanInstructions(lines, plain) {
  const instructions = []
  let parts = null
  const bodies = []
  lines.forEach((line, index) => {
    // Inside a heredoc, until the line of its word alone — `<<-` lets tabs stand before it.
    if (bodies.length > 0) {
      const [{ dash, word }] = bodies
      if ((dash ? line.replace(/^\t+/, '') : line) === word) bodies.shift()
      return
    }
    // A comment is never an instruction, nor goes on with one, whatever it ends with; a blank line
    // inside an instruction is no part of it — as BuildKit reads them.
    if (/^[\t ]*#/.test(line) || (parts && /^[\t ]*$/.test(line))) return
    const continued = /\\[\t ]*$/.test(line)
    const part = continued ? line.replace(/\\[\t ]*$/, '') : line
    if (parts) parts.text += ` ${part}`
    else parts = { text: part, number: index + 1 }
    if (!continued) {
      instructions.push(parts)
      const { instruction, args } = wordsOf(parts.text)
      if (TAKES_HEREDOCS.has(instruction ?? '') && !plain.has(parts.number)) {
        for (const [, dash, word] of args.map((arg) => HEREDOC.exec(arg)).filter(Boolean)) {
          bodies.push({ dash, word: shellWord(word), opened: parts.number })
        }
      }
      parts = null
    }
  })
  if (parts) instructions.push(parts)
  return { instructions, unclosed: bodies[0]?.opened }
}

/** The instructions of a Dockerfile, each its lines joined at `\` and the number of its first line;
 * the body of a heredoc is no instruction (adversarial Б2 of MOL-365: `user nginx;` of a config).
 * **A heredoc that never closes is no heredoc** (adversarial Р3-А1): read as one, a word this check
 * spells otherwise than BuildKit made the rest of the file a body, and every `FROM` and `USER` below
 * went unread. Its lines are read as instructions instead, as before MOL-365 — in doubt, the check
 * sees too much, never too little. */
function instructionsOf(text) {
  const lines = linesOf(text)
  const plain = new Set()
  for (;;) {
    const { instructions, unclosed } = scanInstructions(lines, plain)
    if (unclosed === undefined) return instructions
    plain.add(unclosed)
  }
}

/** A value with the quotes BuildKit takes off it taken off. */
const unquoted = (value) => value.replace(/^(['"])(.*)\1$/, '$2')

/** The parts of a text between separators, a separator inside quotes or escaped kept, as BuildKit reads
 * its flags and a mount's CSV; the quotes and backslashes stay, for `unquoted` or `shellWord`. */
function splitOutsideQuotes(text, separator) {
  const parts = []
  let part = ''
  let quote = null
  let escaped = false
  for (const char of text) {
    // A backslash outside single quotes escapes the next character, as BuildKit's lexer reads it
    // (adversarial Р3-А2: `it\'s` opened no quote there).
    if (escaped) {
      escaped = false
    } else if (char === '\\' && quote !== "'") {
      escaped = true
    } else if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (separator.test(char)) {
      if (part) parts.push(part)
      part = ''
      continue
    }
    part += char
  }
  if (part) parts.push(part)
  return parts
}

/** An instruction's word, in capitals, its flags and the rest of its words. */
function wordsOf(line) {
  const [word, ...rest] = splitOutsideQuotes(line.trim(), /\s/)
  return {
    instruction: word?.toUpperCase(),
    flags: rest.filter((part) => part.startsWith('--')),
    args: rest.filter((part) => !part.startsWith('--')),
  }
}

/** The name a `FROM` gives its stage, in lower case — `FROM image AS name`, `AS` in any case. */
const stageOf = (args) => (args[1]?.toUpperCase() === 'AS' ? args[2]?.toLowerCase() : undefined)

/** The images one instruction takes from elsewhere: `COPY --from`, `RUN --mount=…,from=`. */
function sourcesOf(instruction, flags) {
  if (instruction === 'COPY') {
    return flags.filter((flag) => flag.startsWith('--from=')).map((flag) => unquoted(flag.slice(7)))
  }
  if (instruction === 'RUN') {
    // A mount is a line of CSV whose keys BuildKit reads in any case.
    return flags
      .filter((flag) => flag.startsWith('--mount='))
      .flatMap((flag) => splitOutsideQuotes(flag.slice(8), /,/))
      .map(unquoted)
      .filter((pair) => pair.toLowerCase().startsWith('from='))
      .map((pair) => unquoted(pair.slice(5)))
  }
  return []
}

/** What is wrong with the images of one Dockerfile, in sentences. */
export function dockerfileProblems(path, text) {
  const problems = []
  const stages = new Set()
  // Parser directives stand first, before any other comment, blank line or instruction; `syntax`
  // names the image BuildKit hands the whole file to — the first word of its value. As BuildKit
  // reads them: a first line of `#!` passed over.
  for (const [index, line] of linesOf(text).entries()) {
    if (index === 0 && line.startsWith('#!')) continue
    const directive = DIRECTIVE.exec(line)
    if (!directive || !DIRECTIVE_KEYS.has(directive[1].toLowerCase())) break
    const image = directive[2].split(/\s+/)[0]
    const problem = directive[1].toLowerCase() === 'syntax' ? imageProblem(image) : null
    if (problem) problems.push(`${path}:${String(index + 1)}: ${problem}`)
  }
  for (const { text: line, number } of instructionsOf(text)) {
    const { instruction, flags, args } = wordsOf(line)
    const images = instruction === 'FROM' ? [args[0]] : sourcesOf(instruction, flags)
    for (const image of images) {
      const problem = imageProblem(image, stages)
      if (problem) problems.push(`${path}:${String(number)}: ${problem}`)
    }
    // A stage is named only after its own line: it cannot be its own base, and Docker takes that
    // one from the registry.
    const stage = instruction === 'FROM' ? stageOf(args) : undefined
    if (stage) stages.add(stage)
  }
  return problems
}

/** Root by its name, or uid 0 as Docker reads a number (`strconv.Atoi`: `00`, `+0`, `-0`). */
const isRoot = (id) => id === 'root' || /^[+-]?0+$/.test(id)

/** What is wrong with the last stage of one Dockerfile, in sentences: its name, its user. */
export function lastStageProblems(path, text) {
  let last = null
  let user = null
  for (const { text: line, number } of instructionsOf(text)) {
    const { instruction, args } = wordsOf(line)
    if (instruction === 'FROM') {
      last = { number, name: stageOf(args) }
      user = null
    } else if (instruction === 'USER' && args[0]) {
      user = unquoted(args[0])
    }
  }
  if (last === null) return []
  const where = `${path}:${String(last.number)}`
  const problems = []
  if (last.name !== 'runtime') {
    problems.push(
      `${where}: the last stage is not named runtime, the stage the release builds afresh (no-cache-filters) — FROM … AS runtime`,
    )
  }
  const [name, group] = user?.split(':') ?? []
  if (!name) {
    problems.push(
      `${where}: the last stage names no user — the base's is not taken; USER <name or uid>`,
    )
  } else if (user?.includes('$')) {
    problems.push(`${where}: USER ${user} — named by an argument, which this check cannot read`)
  } else if (isRoot(name) || (group !== undefined && isRoot(group))) {
    problems.push(`${where}: USER ${user} — root, by its user or its group; name another`)
  }
  return problems
}

/** The directories the docker entry of `dependabot.yml` names, as it is written there. */
function watchedDirectories(text) {
  const lines = text.split(/\r?\n/)
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
  const patterns = [...watched]
    .filter((directory) => /[*?[{]/.test(directory))
    .map(
      (directory) =>
        `${DEPENDABOT}: ${directory} — a pattern this check cannot read; list the directories it means`,
    )
  const missing = dockerfiles
    .map((path) => `/${path.split('/').slice(0, -1).join('/')}`)
    .filter((directory, index, all) => all.indexOf(directory) === index && !watched.has(directory))
    .map(
      (directory) =>
        `${DEPENDABOT}: ${directory} has a Dockerfile Dependabot does not watch — add it to the docker entry's directories`,
    )
  return [...patterns, ...missing]
}

/** Every pin problem of the files given, each a path and its text. */
export function pinProblems(files) {
  return files.flatMap(({ path, text }) =>
    isYaml(path) ? workflowProblems(path, text) : dockerfileProblems(path, text),
  )
}

/** The Dockerfiles of those given that take an image — the ones Dependabot has a pin to move in. */
export const imageTakers = (files) =>
  files
    .filter(
      ({ path, text }) =>
        isDockerfile(path) &&
        instructionsOf(text).some(({ text: line }) => wordsOf(line).instruction === 'FROM'),
    )
    .map(({ path }) => path)

/** Every problem of the repository as git tracks it — what `npm run lint` runs. */
export function repositoryProblems() {
  const paths = checkedPaths(
    execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean),
  )
  const files = paths.map((path) => ({ path, text: readFileSync(path, 'utf8') }))
  return [
    ...pinProblems(files),
    ...files
      .filter(({ path }) => isDockerfile(path))
      .flatMap(({ path, text }) => lastStageProblems(path, text)),
    ...dependabotProblems(imageTakers(files), readFileSync(DEPENDABOT, 'utf8')),
  ]
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const problems = repositoryProblems()
  if (problems.length > 0) {
    console.error('pins and last stages (MOL-364, MOL-365):')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
}
