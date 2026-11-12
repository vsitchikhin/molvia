// The releases of master (MOL-376, MOL-381): which branch is the next release and its tag, whether the
// night may release it, what a merge into master was, which release branches have had their day, and
// which branch may ask master at all. The workflows ask it; what it decides is `.claude/rules/deploy.md`,
// «One release a day».
//
//   node bin/release.mjs next                      the next release, JSON: n, name, tag, branch
//   node bin/release.mjs due <schedule|dispatch>   the night's word on the merges of master (stdin)
//   node bin/release.mjs after <subject>           what a merge commit of master leaves to do, JSON
//   node bin/release.mjs source                    refuses a pull request into master from elsewhere
//   node bin/release.mjs ping <ok|fail> [words]    the outcome to healthchecks.io, `HC_RELEASE_URL`

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { setTimeout as sleep } from 'node:timers/promises'

// The line of releases a tag's number counts in: `v0.2.<n>`. A new line is a decision of the plan,
// and the rotation of names below starts over with it.
const LINE = 'v0.2'

// Owner's В-9 of MOL-376: a stone, a wind, a river, each list in alphabetical order, each starting
// over at its end. The only copy of the lists — `deploy.md` names this file.
// prettier-ignore
export const NAMES = [
  [
    'agate', 'amethyst', 'azurite', 'beryl', 'calcite', 'cinnabar', 'citrine', 'diopside', 'dolomite',
    'emerald', 'epidote', 'feldspar', 'fluorite', 'galena', 'garnet', 'gypsum', 'hematite', 'howlite',
    'iolite', 'jade', 'jasper', 'kunzite', 'kyanite', 'labradorite', 'lazurite', 'magnetite', 'malachite',
    'nephrite', 'obsidian', 'onyx', 'opal', 'peridot', 'pyrite', 'quartz', 'rhodonite', 'ruby', 'sapphire',
    'sodalite', 'spinel', 'topaz', 'tourmaline', 'turquoise', 'unakite', 'variscite', 'wulfenite', 'xenotime',
    'zircon', 'zoisite',
  ],
  [
    'alize', 'berg', 'bora', 'brickfielder', 'buran', 'chergui', 'chinook', 'elephanta', 'etesian', 'foehn',
    'gregale', 'haboob', 'harmattan', 'karaburan', 'khamsin', 'kona', 'levante', 'leveche', 'libeccio',
    'marin', 'meltemi', 'mistral', 'ostro', 'pampero', 'papagayo', 'simoom', 'sirocco', 'solano', 'sukhovey',
    'tramontane', 'vendaval', 'williwaw', 'zonda',
  ],
  [
    'amazon', 'amur', 'araks', 'brahmaputra', 'congo', 'danube', 'debed', 'dnieper', 'don', 'drina', 'ebro',
    'elbe', 'euphrates', 'fraser', 'ganges', 'hrazdan', 'hudson', 'indus', 'irtysh', 'jordan', 'kura', 'lena',
    'loire', 'mekong', 'mississippi', 'morava', 'niger', 'nile', 'ob', 'oder', 'orinoco', 'po', 'rhine',
    'rhone', 'sava', 'seine', 'shannon', 'tagus', 'thames', 'tigris', 'ural', 'vistula', 'volga', 'yangtze',
    'yenisei', 'yukon', 'zambezi',
  ],
]

// A night's merge says so in its subject, which is how the night tells its own release from one made
// by hand (owner's В-4 «а» of MOL-381): only the second holds the next night back.
export const NIGHT_MARK = '(night)'

const DAY_MS = 24 * 60 * 60 * 1000

/** The name of release `n` of the line: `v0.2.1` is the first, agate. */
export function releaseName(n) {
  const theme = NAMES[(n - 1) % NAMES.length]
  return theme[Math.floor((n - 1) / NAMES.length) % theme.length]
}

/** A tag of the line read: `n`, its name and a hotfix's number — or null for anything else. */
export function parseTag(tag) {
  const match = /^v0\.2\.(\d+)(?:-([a-z]+)(?:-(\d+))?)?$/.exec(tag)
  if (!match) return null
  return {
    n: Number(match[1]),
    name: match[2] ?? null,
    hotfix: match[3] === undefined ? null : Number(match[3]),
  }
}

/** The last release among the tags, a hotfix aside: its `n`, 0 for none. */
export function lastRelease(tags) {
  let last = 0
  for (const tag of tags) {
    const parsed = parseTag(tag)
    if (parsed && parsed.hotfix === null) last = Math.max(last, parsed.n)
  }
  return last
}

/** Release `n` whole: its name, tag and branch. */
export function release(n) {
  const name = releaseName(n)
  return { n, name, tag: `${LINE}.${String(n)}-${name}`, branch: `release/${name}` }
}

/** The release the tags wait for next. */
export function nextRelease(tags) {
  return release(lastRelease(tags) + 1)
}

/**
 * The branch of a merge commit of master, by the subject GitHub writes —
 * `Merge pull request #320 from vsitchikhin/release/agate` — or null for a squash or a commit of
 * another shape. A night's merge carries its mark after the branch.
 */
export function mergedBranch(subject) {
  const match = /^Merge pull request #\d+ from [\w.-]+\/(\S+)/.exec(subject)
  return match ? match[1] : null
}

/**
 * Whether the night may release (owner's В-10 of MOL-376, В-4 «а» of MOL-381): the branch differs from
 * master by its files — a merge of master after a hotfix alone does not — and, at night, no release went
 * out by hand within 24 hours. A release of the night before never holds the next one back: GitHub's
 * cron runs late, and a run on time after a late one would find less than 24 hours. A hotfix is not
 * the day's release. The owner's «выпускай», a run by hand, asks only for the difference.
 */
export function releaseDue({ event, differs, merges, now }) {
  if (!differs) return { due: false, reason: 'the release branch holds nothing master does not' }
  if (event !== 'schedule') return { due: true, reason: 'released by hand' }
  for (const { at, subject } of merges) {
    const branch = mergedBranch(subject)
    if (!branch?.startsWith('release/') || subject.includes(NIGHT_MARK)) continue
    const age = now.getTime() - at.getTime()
    if (age >= 0 && age < DAY_MS) {
      return {
        due: false,
        reason: `${branch} went out by hand ${String(Math.floor(age / 3_600_000))} h ago`,
      }
    }
  }
  return { due: true, reason: 'nothing went out by hand in 24 hours' }
}

/**
 * What a merge into master leaves to do, by its branch: a release is tagged, the next branch is cut and
 * the branches older than the one before it go; a hotfix of the release that is out is tagged with its
 * number and master goes into the next release branch. Anything else — Dependabot, a squash — nothing.
 * A release or a hotfix out of turn is an error: the tags are the record and a wrong one stays. A run
 * again after its tag went is the same answer, so the workflow can finish what a failure left; that
 * the tag stands on this very commit is the workflow's to check.
 */
export function afterMerge(branch, tags) {
  if (!branch) return { kind: 'none' }
  const last = lastRelease(tags)
  const released = /^release\/([a-z]+)$/.exec(branch)
  if (released) {
    const n = [last + 1, last].find((m) => m > 0 && release(m).name === released[1])
    if (n === undefined) {
      throw new Error(`${branch} merged, but the next release is ${release(last + 1).branch}`)
    }
    const stale = []
    for (let m = 1; m < n - 1; m += 1) stale.push(release(m).branch)
    return { kind: 'release', tag: release(n).tag, next: release(n + 1).branch, stale }
  }
  const fixed = /^hotfix\/([a-z]+)-(\d+)$/.exec(branch)
  if (fixed) {
    if (last === 0) throw new Error(`${branch} merged, but no named release is out`)
    const out = release(last)
    if (fixed[1] !== out.name) {
      throw new Error(`${branch} merged, but the release that is out is ${out.name}`)
    }
    const k = Number(fixed[2])
    if (k < 1) throw new Error(`${branch}: a hotfix is numbered from 1`)
    return { kind: 'hotfix', tag: `${out.tag}-${String(k)}`, next: release(last + 1).branch }
  }
  return { kind: 'none' }
}

/**
 * Whether a pull request may go into its base (MOL-376): master takes a release, a hotfix and, by
 * owner's В-7 «б» of MOL-381, Dependabot; any other base takes anything.
 */
export function sourceAllowed(base, head) {
  if (base !== 'master') return true
  return /^(?:release\/[a-z]+|hotfix\/[a-z]+-\d+|dependabot\/.+)$/.test(head)
}

function tags() {
  return execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
}

/**
 * The outcome to the check `molvia-release`. healthchecks.io answers every ping with 200 and says what
 * became of it (MOL-221, as `watch.yml`): `OK` taken; `OK (not found)` no such check, a run that could
 * not report; anything else is tried again, a second, two and four apart.
 */
async function ping(outcome, words) {
  const url = process.env.HC_RELEASE_URL ?? ''
  if (!url.startsWith('https://')) throw new Error('the secret HC_RELEASE_URL is not an https URL')
  const target = outcome === 'fail' ? `${url}/fail` : url
  for (const pause of [1, 2, 4, 0]) {
    const answer = await fetch(target, {
      method: 'POST',
      body: words,
      signal: AbortSignal.timeout(10_000),
    }).then(
      async (response) =>
        response.ok ? (await response.text()).trim() : `HTTP ${String(response.status)}`,
      (error) => String(error),
    )
    if (answer === 'OK') return
    if (answer === 'OK (not found)')
      throw new Error('healthchecks.io knows no check at HC_RELEASE_URL')
    if (pause === 0) throw new Error(`healthchecks.io did not take the ping: ${answer}`)
    await sleep(pause * 1000)
  }
}

async function main([command, ...args]) {
  switch (command) {
    case 'next':
      return JSON.stringify(nextRelease(tags()))
    case 'due': {
      // stdin: `git log --first-parent --format='%cI%x09%s'` of master, a merge a line.
      const merges = readFileSync(0, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [at, ...subject] = line.split('\t')
          return { at: new Date(at), subject: subject.join('\t') }
        })
      const differs = process.env.DIFFERS === 'true'
      const verdict = releaseDue({ event: args[0], differs, merges, now: new Date() })
      return JSON.stringify(verdict)
    }
    case 'after':
      return JSON.stringify(afterMerge(mergedBranch(args[0] ?? ''), tags()))
    case 'source': {
      const base = process.env.BASE_REF ?? ''
      const head = process.env.HEAD_REF ?? ''
      if (sourceAllowed(base, head)) return `${head || 'a push'} → ${base || 'its branch'}: allowed`
      throw new Error(
        `master takes release/<name>, hotfix/<name>-<k> and dependabot/* only, not ${head}: aim the pull request at the current release/<name> (CLAUDE.md, «Releases»)`,
      )
    }
    case 'ping':
      await ping(args[0], args.slice(1).join(' '))
      return `pinged ${String(args[0])}`
    default:
      throw new Error(`unknown command ${String(command)}`)
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main(process.argv.slice(2)).then(
    (out) => console.log(out),
    (error) => {
      console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    },
  )
}
