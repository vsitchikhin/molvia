import { describe, expect, it } from 'vitest'
import { auditVerdict, seriousAdvisories } from './npm-audit.mjs'

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

  it('is red when there was no report: could not check is never clean', () => {
    const { problems } = auditVerdict({ message: 'ECONNREFUSED' }, [], TODAY)
    expect(problems).toEqual(['npm audit gave no report: ECONNREFUSED — could not check'])
  })
})
