// `npm audit` of what ships (MOL-369, owner's В-4 «б»): the dependencies of the lockfile less the development
// ones — those are Dependabot's — but workbox's runtime, which the PWA's build copies into `sw.js`
// (`SHIPPED_FROM_DEVELOPMENT`). A high or critical advisory turns CI red unless `bin/npm-audit-accepted.json`
// accepts it: its GHSA, the reason, and the day to look again — a year ahead at most — after which it is red
// once more. npm has no list of its own, and `--audit-level=high` alone would hold every pull request on the
// day an advisory comes with no fix — a hotfix included. A report that did not come — the registry down — is
// red too: «could not check» is never «clean».
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ACCEPTED = 'bin/npm-audit-accepted.json'
const SERIOUS = new Set(['high', 'critical'])
const GHSA = /\/(GHSA(?:-[0-9a-z]{4}){3})$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const ACCEPTED_AT_MOST_DAYS = 366
// vite-plugin-pwa's `generateSW` copies workbox's runtime into the build, and the worker runs it on every
// request of the page, though the lockfile calls it development's (adversarial Б1); its builder stays there.
const SHIPPED_FROM_DEVELOPMENT = /^workbox-(?!build$)/

/**
 * Whether a package of the report reaches an image: a path of it the lockfile does not call development's,
 * or a name of `SHIPPED_FROM_DEVELOPMENT`. With no lockfile, or a path it does not know, in doubt it does.
 */
function ships(name, { nodes }, lock) {
  if (SHIPPED_FROM_DEVELOPMENT.test(name)) return true
  if (!lock?.packages || !Array.isArray(nodes) || nodes.length === 0) return true
  return nodes.some((node) => lock.packages[node]?.dev !== true)
}

/**
 * The high and critical advisories of a report of `npm audit --json` in what ships by the lockfile, each
 * once; null if it is no report.
 */
export function seriousAdvisories(report, lock) {
  if (report?.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object') return null
  const found = new Map()
  for (const [name, entry] of Object.entries(report.vulnerabilities)) {
    if (!ships(name, entry, lock)) continue
    for (const advisory of entry.via ?? []) {
      // A name in `via` is the package an advisory came through; the advisory is its own entry.
      if (typeof advisory !== 'object' || !SERIOUS.has(advisory.severity)) continue
      const id = GHSA.exec(advisory.url ?? '')?.[1] ?? advisory.url ?? String(advisory.source)
      found.set(id, { id, name: advisory.name, title: advisory.title, severity: advisory.severity })
    }
  }
  return [...found.values()]
}

/** The day `days` after a day, YYYY-MM-DD; null where the day is none — a month 13 is no time at all. */
function dayAfter(day, days) {
  const time = Date.parse(`${day}T00:00:00Z`)
  return Number.isNaN(time) ? null : new Date(time + days * 86_400_000).toISOString().slice(0, 10)
}

/** What is wrong with one line of the accepted list, or null. */
function entryProblem(entry, index, today) {
  const where = `${ACCEPTED}[${String(index)}]`
  if (!/^GHSA(?:-[0-9a-z]{4}){3}$/.test(entry?.advisory ?? '')) {
    return `${where}: "advisory" is a GHSA id`
  }
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
    return `${where}: ${entry.advisory} names no "reason"`
  }
  const until = typeof entry.until === 'string' && DAY.test(entry.until) ? entry.until : null
  // A day of the calendar: `Date.parse` takes 2026-02-30 for the 2nd of March.
  if (until === null || dayAfter(until, 0) !== until) {
    return `${where}: ${entry.advisory} — "until" is the day to look again, YYYY-MM-DD`
  }
  const latest = dayAfter(today, ACCEPTED_AT_MOST_DAYS)
  if (until > latest) {
    return `${where}: ${entry.advisory} — "until" is a year ahead at most, ${latest}`
  }
  return null
}

/**
 * The report judged against the accepted list on a day (UTC, YYYY-MM-DD) and the lockfile: `problems` turn
 * CI red, `notes` are said beside it.
 */
export function auditVerdict(report, accepted, today, lock) {
  const advisories = seriousAdvisories(report, lock)
  if (advisories === null) {
    const said = typeof report?.message === 'string' ? `: ${report.message}` : ''
    return { problems: [`npm audit gave no report${said} — could not check`], notes: [] }
  }
  const list = Array.isArray(accepted) ? accepted : []
  const problems = Array.isArray(accepted) ? [] : [`${ACCEPTED}: a list of lines`]
  const notes = []
  list.forEach((entry, index) => {
    const problem = entryProblem(entry, index, today)
    if (problem) problems.push(problem)
  })
  for (const { id, name, title, severity } of advisories) {
    const what = `${severity} ${id} in ${name}: ${title}`
    const entry = list.find((line) => line?.advisory === id)
    if (!entry) {
      problems.push(
        `${what} — bring it up to date, or accept it in ${ACCEPTED} with a reason and a day to look again`,
      )
    } else if (entry.until < today) {
      problems.push(`${what} — accepted until ${entry.until}, which has passed: look at it again`)
    } else {
      notes.push(`${what} — accepted until ${entry.until}: ${entry.reason}`)
    }
  }
  for (const entry of list) {
    if (entry?.advisory && !advisories.some(({ id }) => id === entry.advisory)) {
      notes.push(`${entry.advisory} is no longer reported — take its line out of ${ACCEPTED}`)
    }
  }
  return { problems, notes }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  // The whole tree, development's too, judged by the lockfile: `--omit=dev` would not ask about workbox.
  // npm exits non-zero whenever it found anything; the report is read whatever the code.
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' })
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    report = { message: run.stderr.trim().split('\n').at(-1) ?? 'no output' }
  }
  const accepted = JSON.parse(readFileSync(ACCEPTED, 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  const today = new Date().toISOString().slice(0, 10)
  const { problems, notes } = auditVerdict(report, accepted, today, lock)
  const github = Boolean(process.env.GITHUB_ACTIONS)
  for (const note of notes) console.log(github ? `::warning::${note}` : `note: ${note}`)
  for (const problem of problems) console.error(github ? `::error::${problem}` : `  ${problem}`)
  if (problems.length > 0) {
    console.error('npm audit of what ships (MOL-369): high or critical not accepted')
    process.exitCode = 1
  } else {
    console.log('npm audit of what ships: nothing high or critical but what is accepted')
  }
}
