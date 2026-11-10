import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { auditVerdict, seriousAdvisories, type Lock } from './npm-audit.mjs'

const TODAY = '2026-11-10'

const advisory = (id: string, severity: string, name = 'fast-uri') => ({
  source: 1,
  name,
  dependency: name,
  title: `${name}: something`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: '<9.9.9',
})

// The shape of `npm audit --json`: an advisory is an object in `via`, a package it came through a name.
const report = (...vias: unknown[][]) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(vias.map((via, index) => [`p${String(index)}`, { via }])),
})

const HIGH = 'GHSA-aaaa-bbbb-cccc'
const CRITICAL = 'GHSA-dddd-eeee-ffff'
const accept = (advisory: string, until: string) => ({ advisory, reason: 'no fix yet', until })

describe('seriousAdvisories', () => {
  it('takes high and critical once, leaves moderate and the names of packages it came through', () => {
    const found = seriousAdvisories(
      report(
        [advisory(HIGH, 'high')],
        ['fast-uri', advisory(HIGH, 'high')],
        [advisory('GHSA-mmmm-mmmm-mmmm', 'moderate')],
        [advisory(CRITICAL, 'critical', 'uuid')],
      ),
    )
    expect(found?.map(({ id, severity }) => `${id} ${severity}`)).toEqual([
      `${HIGH} high`,
      `${CRITICAL} critical`,
    ])
  })

  // The whole tree is audited, so the lockfile says what ships: development's is Dependabot's, but the
  // runtime of workbox the PWA's build copies into `sw.js` (adversarial Б1).
  it('leaves out what only development needs, and keeps workbox, a path that ships and one unknown', () => {
    const lock: Lock = {
      packages: {
        'node_modules/vitest': { dev: true },
        'node_modules/workbox-build': { dev: true },
        'node_modules/workbox-precaching': { dev: true },
        'node_modules/glob': { dev: true },
        'node_modules/exceljs/node_modules/glob': {},
      },
    }
    const ids = ['GHSA-aaaa-0000-0001', 'GHSA-aaaa-0000-0002', 'GHSA-aaaa-0000-0003']
    const found = seriousAdvisories(
      {
        auditReportVersion: 2,
        vulnerabilities: {
          vitest: {
            via: [advisory('GHSA-dddd-0000-0001', 'high', 'vitest')],
            nodes: ['node_modules/vitest'],
          },
          'workbox-build': {
            via: [advisory('GHSA-dddd-0000-0002', 'high', 'workbox-build')],
            nodes: ['node_modules/workbox-build'],
          },
          'workbox-precaching': {
            via: [advisory(ids[0] ?? '', 'high', 'workbox-precaching')],
            nodes: ['node_modules/workbox-precaching'],
          },
          glob: {
            via: [advisory(ids[1] ?? '', 'high', 'glob')],
            nodes: ['node_modules/glob', 'node_modules/exceljs/node_modules/glob'],
          },
          'fast-uri': {
            via: [advisory(ids[2] ?? '', 'critical')],
            nodes: ['node_modules/fast-uri'],
          },
        },
      },
      lock,
    )
    expect(found?.map(({ id }) => id)).toEqual(ids)
  })

  it('reads the lockfile of the repository as the rule means: workbox ships, its builder does not', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as Lock
    const shipped = (name: string) =>
      (seriousAdvisories(
        {
          auditReportVersion: 2,
          vulnerabilities: {
            [name]: { via: [advisory(HIGH, 'high', name)], nodes: [`node_modules/${name}`] },
          },
        },
        lock,
      )?.length ?? 0) > 0
    expect(lock.packages['node_modules/workbox-precaching']?.dev).toBe(true)
    expect(
      ['workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies'].map(shipped),
    ).toEqual([true, true, true, true])
    expect(['workbox-build', 'vitest', 'eslint'].map(shipped)).toEqual([false, false, false])
    expect(shipped('exceljs')).toBe(true)
  })

  it('is null for what is not a report — the registry not answering', () => {
    expect(seriousAdvisories({ message: 'request failed', error: {} })).toBeNull()
    expect(seriousAdvisories(null)).toBeNull()
  })
})

describe('auditVerdict', () => {
  it('is clean with no high and no critical', () => {
    const moderate = report([advisory('GHSA-mmmm-mmmm-mmmm', 'moderate')])
    expect(auditVerdict(moderate, [], TODAY)).toEqual({ problems: [], notes: [] })
  })

  it('is red for a high not accepted', () => {
    const { problems } = auditVerdict(report([advisory(HIGH, 'high')]), [], TODAY)
    expect(problems).toEqual([expect.stringContaining(`high ${HIGH} in fast-uri`)])
  })

  it('lets an accepted one pass up to its day, that day included, and says it', () => {
    const verdict = auditVerdict(
      report([advisory(CRITICAL, 'critical')]),
      [accept(CRITICAL, TODAY)],
      TODAY,
    )
    expect(verdict.problems).toEqual([])
    expect(verdict.notes).toEqual([expect.stringContaining(`accepted until ${TODAY}: no fix yet`)])
  })

  it('is red again the day after', () => {
    const { problems } = auditVerdict(
      report([advisory(CRITICAL, 'critical')]),
      [accept(CRITICAL, '2026-11-09')],
      TODAY,
    )
    expect(problems).toEqual([
      expect.stringContaining('accepted until 2026-11-09, which has passed'),
    ])
  })

  it('names a line no advisory needs any more', () => {
    const { problems, notes } = auditVerdict(report(), [accept(HIGH, '2027-01-01')], TODAY)
    expect(problems).toEqual([])
    expect(notes).toEqual([expect.stringContaining(`${HIGH} is no longer reported`)])
  })

  it('refuses a line without its GHSA, its reason or a day', () => {
    const { problems } = auditVerdict(
      report(),
      [
        { advisory: 'CVE-2026-1', reason: 'x', until: '2027-01-01' },
        { advisory: HIGH, reason: ' ', until: '2027-01-01' },
        { advisory: CRITICAL, reason: 'x', until: 'soon' },
      ],
      TODAY,
    )
    expect(problems).toHaveLength(3)
  })

  it('refuses a day not of the calendar, and one past a year ahead', () => {
    const lines = [
      accept(HIGH, '2026-02-30'),
      accept(HIGH, '2026-13-01'),
      accept(HIGH, '2026-00-10'),
      accept(CRITICAL, '9999-12-31'),
    ]
    const { problems } = auditVerdict(report(), lines, TODAY)
    expect(problems).toEqual([
      expect.stringContaining(`[0]: ${HIGH} — "until" is the day to look again`),
      expect.stringContaining(`[1]: ${HIGH} — "until" is the day to look again`),
      expect.stringContaining(`[2]: ${HIGH} — "until" is the day to look again`),
      expect.stringContaining(`${CRITICAL} — "until" is a year ahead at most, 2027-11-11`),
    ])
    expect(auditVerdict(report(), [accept(HIGH, '2027-11-11')], TODAY).problems).toEqual([])
  })

  it('is red when there was no report: could not check is never clean', () => {
    const { problems } = auditVerdict({ message: 'ECONNREFUSED' }, [], TODAY)
    expect(problems).toEqual(['npm audit gave no report: ECONNREFUSED — could not check'])
  })
})
