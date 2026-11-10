// trivy over the six images of a release (MOL-369, owner's В-2 «а», В-3 «а»): HIGH and CRITICAL that have a
// fix. What our Dockerfile or our lockfile brings up to date — the distribution's packages, `node_modules` —
// is ours and turns the run red; a module inside a Go binary — Caddy, Grafana, VictoriaMetrics, as their
// authors built them — waits for their release, which Dependabot's `images` brings, and is said beside it
// (`security.md`, «What an image carries»). An image not scanned is red too: «could not check» is never
// «clean». Run by `scan.yml`, after a release and daily on what production runs:
//   node bin/scan-images.mjs sha-1a2b3c4
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'

export const IMAGES = ['backend', 'bot', 'frontend', 'receipt-reader', 'grafana', 'victoria']
const CACHE = '.trivy'

/** Every finding of one image's report of `trivy image --format json`, marked ours or another's. */
export function findingsOf(image, report) {
  return (report?.Results ?? []).flatMap((result) =>
    (result.Vulnerabilities ?? []).map((finding) => ({
      image,
      ours: result.Type !== 'gobinary',
      id: finding.VulnerabilityID,
      severity: finding.Severity,
      what: `${finding.PkgName} ${finding.InstalledVersion} → ${finding.FixedVersion}`,
      where: result.Target,
    })),
  )
}

/** The run's summary in Markdown: what failed to scan, then every finding, ours first. */
export function summaryOf(tag, findings, unscanned) {
  const ours = findings.filter((finding) => finding.ours)
  const lines = [
    `### trivy · ${tag}`,
    '',
    `HIGH and CRITICAL with a fix: ${String(ours.length)} ours, ${String(findings.length - ours.length)} inside Go binaries of other releases.`,
    '',
  ]
  for (const { image, reason } of unscanned) lines.push(`- **${image} not scanned**: ${reason}`)
  if (findings.length > 0) {
    lines.push('| image | whose | id | severity | package | in |', '|-|-|-|-|-|-|')
    for (const f of [...ours, ...findings.filter((finding) => !finding.ours)]) {
      lines.push(
        `| ${f.image} | ${f.ours ? 'ours' : 'a Go binary'} | ${f.id} | ${f.severity} | ${f.what} | ${f.where} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

/** One image scanned: its findings, or why it was not. */
function scan(image, reference) {
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--volume',
      `${process.cwd()}/${CACHE}:/cache`,
      'molvia-trivy',
      'image',
      '--cache-dir=/cache',
      '--image-src=remote',
      '--platform=linux/amd64',
      '--scanners=vuln',
      '--severity=HIGH,CRITICAL',
      '--ignore-unfixed',
      '--format=json',
      `--output=/cache/${image}.json`,
      '--quiet',
      reference,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'pipe'] },
  )
  if (run.status !== 0) {
    return { reason: run.stderr.trim().split('\n').at(-1) ?? `trivy exited ${String(run.status)}` }
  }
  return { findings: findingsOf(image, JSON.parse(readFileSync(`${CACHE}/${image}.json`, 'utf8'))) }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const tag = process.argv[2]
  if (!tag) {
    console.error('usage: node bin/scan-images.mjs <tag of the images, sha-… or v…>')
    process.exit(2)
  }
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? 'vsitchikhin'
  mkdirSync(CACHE, { recursive: true })
  const built = spawnSync(
    'docker',
    ['build', '--quiet', '--tag', 'molvia-trivy', '.github/scanners/trivy'],
    { stdio: 'inherit' },
  )
  if (built.status !== 0) process.exit(1)

  const findings = []
  const unscanned = []
  for (const image of IMAGES) {
    const result = scan(image, `ghcr.io/${owner}/molvia-${image}:${tag}`)
    if (result.findings) findings.push(...result.findings)
    else unscanned.push({ image, reason: result.reason })
  }

  const summary = summaryOf(tag, findings, unscanned)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
  const github = Boolean(process.env.GITHUB_ACTIONS)
  for (const { image, reason } of unscanned) {
    console.error(github ? `::error::${image} not scanned: ${reason}` : `${image} not scanned`)
  }
  for (const f of findings) {
    const line = `${f.image}: ${f.severity} ${f.id} in ${f.what}`
    if (f.ours) console.error(github ? `::error::${line}` : `ours: ${line}`)
    else if (github) console.log(`::warning::${line} — inside a Go binary, waits for its release`)
  }
  if (unscanned.length > 0 || findings.some((finding) => finding.ours)) process.exitCode = 1
}
