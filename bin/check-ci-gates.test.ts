import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { gateProblems } from './check-ci-gates.mjs'

const CI = readFileSync('.github/workflows/ci.yml', 'utf8')

/** The workflow with `from` replaced by `to` in the block of the job `key` only. */
function changed(key: string, from: string, to: string): string {
  const start = CI.indexOf(`\n  ${key}:\n`)
  const next = CI.slice(start + 1).search(/\n {2}[\w-]+:\n/)
  const end = next < 0 ? CI.length : start + 1 + next
  const block = CI.slice(start, end)
  expect(block).toContain(from)
  return CI.slice(0, start) + block.replace(from, to) + CI.slice(end)
}

describe('gateProblems', () => {
  it('is quiet for the repository as it stands', () => {
    expect(gateProblems(CI)).toEqual([])
  })

  it('names a gate without `if: always()`, of either', () => {
    for (const [key, name] of [
      ['check', 'format, lint, types, tests'],
      ['e2e-gate', 'end-to-end'],
    ] as const) {
      expect(gateProblems(changed(key, '    if: always()\n', ''))).toEqual([
        `«${name}» runs without \`if: always()\`: skipped where a job it waits for fails, and passed`,
      ])
      expect(gateProblems(changed(key, 'if: always()', 'if: success()'))).toHaveLength(1)
    }
  })

  it('names a job no gate waits for, one two gates wait for, and a gate that waits for none', () => {
    expect(gateProblems(changed('check', 'needs: [static, tests]', 'needs: [static]'))).toEqual([
      '`tests` is waited for by 0 gates, not one',
    ])
    expect(gateProblems(changed('e2e-gate', 'needs: [e2e]', 'needs: [e2e, tests]'))).toEqual([
      '`tests` is waited for by 2 gates, not one',
    ])
    expect(gateProblems(changed('e2e-gate', '    needs: [e2e]\n', ''))).toEqual([
      '«end-to-end» waits for no job, and passes at once',
      '`e2e` is waited for by 0 gates, not one',
    ])
    expect(gateProblems(changed('e2e-gate', 'needs: [e2e]', 'needs: e2e'))).toEqual([])
  })

  it('names a gate that waits for a gate or for a job there is not', () => {
    expect(gateProblems(changed('e2e-gate', 'needs: [e2e]', 'needs: [e2e, check]'))).toEqual([
      '«end-to-end» waits for `check`, which is no job of its own to gather',
    ])
    expect(gateProblems(changed('e2e-gate', 'needs: [e2e]', 'needs: [e2e, lint]'))).toEqual([
      '«end-to-end» waits for `lint`, which is no job of its own to gather',
    ])
  })

  it('names a gate green with no result, or on a result other than success', () => {
    expect(gateProblems(changed('check', '${RESULTS:-none}', '$RESULTS'))).toHaveLength(1)
    expect(gateProblems(changed('e2e-gate', '= success ]', '!= failure ]'))).toHaveLength(1)
    expect(gateProblems(changed('check', "join(needs.*.result, ' ')", "'success'"))).toHaveLength(1)
  })

  it('names a gate whose step may fail or be skipped and leave it green', () => {
    const told = (name: string): string =>
      `«${name}» has a step that may fail or be skipped and leave it green: ` +
      'no `continue-on-error`, no `if:` of a step'
    const loop = '      - name: every shard succeeded\n'
    expect(
      gateProblems(changed('e2e-gate', loop, `${loop}        continue-on-error: true\n`)),
    ).toEqual([told('end-to-end')])
    expect(
      gateProblems(
        changed('check', '      - run: node', '      - continue-on-error: true\n        run: node'),
      ),
    ).toEqual([told('format, lint, types, tests')])
    expect(
      gateProblems(changed('check', '    runs-on:', '    continue-on-error: true\n    runs-on:')),
    ).toEqual([told('format, lint, types, tests')])
    expect(gateProblems(changed('e2e-gate', loop, `${loop}        if: false\n`))).toEqual([
      told('end-to-end'),
    ])
    expect(
      gateProblems(changed('check', '      - run: node', '      - if: false\n        run: node')),
    ).toEqual([told('format, lint, types, tests')])
  })

  it('names a gate that no longer runs the check, and a name the ruleset requires that no job bears', () => {
    expect(
      gateProblems(changed('e2e-gate', 'run: node bin/check-ci-gates.mjs', 'run: true')),
    ).toEqual(['«end-to-end» does not run `node bin/check-ci-gates.mjs`'])
    expect(gateProblems(changed('e2e-gate', 'name: end-to-end\n', 'name: e2e\n'))).toEqual([
      '«end-to-end» is the name of 0 jobs, not one',
    ])
  })
})
