import { describe, expect, it } from 'vitest'
import {
  NAMES,
  NIGHT_MARK,
  afterMerge,
  lastRelease,
  mergedBranch,
  nextRelease,
  parseTag,
  releaseDue,
  releaseName,
  sourceAllowed,
} from './release.mjs'

const TAGS = ['v0.1.5', 'v0.2.0', 'v0.2.1-agate']
const NOW = new Date('2026-11-13T23:05:00Z')
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000)
const merge = (branch: string, n = 320): string =>
  `Merge pull request #${String(n)} from vsitchikhin/${branch}`

describe('releaseName', () => {
  it('takes a stone, a wind and a river in turn, each list in its order', () => {
    expect([1, 2, 3, 4, 5, 6].map(releaseName)).toEqual([
      'agate',
      'alize',
      'amazon',
      'amethyst',
      'berg',
      'amur',
    ])
  })

  it('starts a list over at its end, each list on its own', () => {
    const [stones, winds] = NAMES
    expect(releaseName(1 + 3 * (stones.length - 1))).toBe('zoisite')
    expect(releaseName(1 + 3 * stones.length)).toBe('agate')
    expect(releaseName(2 + 3 * winds.length)).toBe('alize')
  })
})

describe('the tags', () => {
  it('reads the line of 0.2 with a name and a hotfix, and nothing else', () => {
    expect(parseTag('v0.2.0')).toEqual({ n: 0, name: null, hotfix: null })
    expect(parseTag('v0.2.1-agate')).toEqual({ n: 1, name: 'agate', hotfix: null })
    expect(parseTag('v0.2.1-agate-2')).toEqual({ n: 1, name: 'agate', hotfix: 2 })
    expect(parseTag('v0.1.5')).toBeNull()
    expect(parseTag('v0.2.1-Agate')).toBeNull()
  })

  it('counts the last release past the hotfixes', () => {
    expect(lastRelease(['v0.1.5'])).toBe(0)
    expect(lastRelease([...TAGS, 'v0.2.1-agate-1'])).toBe(1)
  })

  it('names the next release after v0.2.0 and after a named one', () => {
    expect(nextRelease(['v0.2.0'])).toEqual({
      n: 1,
      name: 'agate',
      tag: 'v0.2.1-agate',
      branch: 'release/agate',
    })
    expect(nextRelease(TAGS)).toEqual({
      n: 2,
      name: 'alize',
      tag: 'v0.2.2-alize',
      branch: 'release/alize',
    })
  })
})

describe('mergedBranch', () => {
  it('reads the branch of GitHub’s merge commit, the night’s mark aside', () => {
    expect(mergedBranch(merge('release/agate'))).toBe('release/agate')
    expect(mergedBranch(`${merge('release/alize')} ${NIGHT_MARK}`)).toBe('release/alize')
  })

  it('reads no branch off a squash or a commit of another shape', () => {
    expect(mergedBranch('chore(deps): bump stylelint from 17.16.0 to 18.0.0 (#316)')).toBeNull()
    expect(mergedBranch('')).toBeNull()
  })
})

describe('releaseDue', () => {
  const due = (event: string, merges: { at: Date; subject: string }[], differs = true) =>
    releaseDue({ event, differs, merges, now: NOW })

  it('releases nothing when the branch holds nothing master does not, by hand too', () => {
    expect(due('schedule', [], false).due).toBe(false)
    expect(due('workflow_dispatch', [], false).due).toBe(false)
  })

  it('holds the night back after a release by hand within 24 hours', () => {
    const verdict = due('schedule', [{ at: hoursAgo(23), subject: merge('release/agate') }])
    expect(verdict).toEqual({ due: false, reason: 'release/agate went out by hand 23 h ago' })
  })

  it('releases at night once the release by hand is 24 hours old', () => {
    expect(due('schedule', [{ at: hoursAgo(24), subject: merge('release/agate') }]).due).toBe(true)
    expect(due('schedule', [{ at: hoursAgo(25), subject: merge('release/agate') }]).due).toBe(true)
  })

  it('is not held back by the night before, however late it ran', () => {
    const night = { at: hoursAgo(22), subject: `${merge('release/agate')} ${NIGHT_MARK}` }
    expect(due('schedule', [night]).due).toBe(true)
  })

  it('is not held back by a hotfix nor by Dependabot', () => {
    expect(due('schedule', [{ at: hoursAgo(1), subject: merge('hotfix/agate-1') }]).due).toBe(true)
    expect(
      due('schedule', [{ at: hoursAgo(1), subject: merge('dependabot/npm_and_yarn/x') }]).due,
    ).toBe(true)
  })

  it('releases by hand whatever went out within the day', () => {
    expect(
      due('workflow_dispatch', [{ at: hoursAgo(1), subject: merge('release/agate') }]).due,
    ).toBe(true)
  })
})

describe('afterMerge', () => {
  it('tags a release, cuts the next branch and lets go those older than the one before', () => {
    expect(afterMerge('release/alize', TAGS)).toEqual({
      kind: 'release',
      tag: 'v0.2.2-alize',
      next: 'release/amazon',
      stale: [],
    })
    expect(afterMerge('release/berg', ['v0.2.0', 'v0.2.4-amethyst'])).toEqual({
      kind: 'release',
      tag: 'v0.2.5-berg',
      next: 'release/amur',
      stale: ['release/agate', 'release/alize', 'release/amazon'],
    })
  })

  it('refuses a release out of turn', () => {
    expect(() => afterMerge('release/amazon', TAGS)).toThrow('the next release is release/alize')
  })

  it('tags a hotfix of the release that is out and sends master to the next branch', () => {
    expect(afterMerge('hotfix/agate-1', TAGS)).toEqual({
      kind: 'hotfix',
      tag: 'v0.2.1-agate-1',
      next: 'release/alize',
    })
    expect(afterMerge('hotfix/agate-2', [...TAGS, 'v0.2.1-agate-1']).kind).toBe('hotfix')
  })

  it('refuses a hotfix of another release, a number taken and a number 0', () => {
    expect(() => afterMerge('hotfix/alize-1', TAGS)).toThrow('the release that is out is agate')
    expect(() => afterMerge('hotfix/agate-1', [...TAGS, 'v0.2.1-agate-1'])).toThrow('not a new one')
    expect(() => afterMerge('hotfix/agate-0', TAGS)).toThrow('not a new one')
    expect(() => afterMerge('hotfix/agate-1', ['v0.2.0'])).toThrow('no named release is out')
  })

  it('leaves Dependabot, a squash and a task nothing to do', () => {
    expect(afterMerge('dependabot/npm_and_yarn/x', TAGS)).toEqual({ kind: 'none' })
    expect(afterMerge(null, TAGS)).toEqual({ kind: 'none' })
    expect(afterMerge('MOL-381-release-automation', TAGS)).toEqual({ kind: 'none' })
  })
})

describe('sourceAllowed', () => {
  it('lets a release, a hotfix and Dependabot into master', () => {
    expect(sourceAllowed('master', 'release/alize')).toBe(true)
    expect(sourceAllowed('master', 'hotfix/agate-1')).toBe(true)
    expect(sourceAllowed('master', 'dependabot/npm_and_yarn/stylelint-18.0.0')).toBe(true)
  })

  it('refuses a task, a helper and a hotfix without its number', () => {
    expect(sourceAllowed('master', 'MOL-381-release-automation')).toBe(false)
    expect(sourceAllowed('master', 'release/alize-fix')).toBe(false)
    expect(sourceAllowed('master', 'hotfix/agate')).toBe(false)
  })

  it('leaves every other base alone, and a push with no base', () => {
    expect(sourceAllowed('release/alize', 'MOL-381-release-automation')).toBe(true)
    expect(sourceAllowed('', '')).toBe(true)
  })
})
