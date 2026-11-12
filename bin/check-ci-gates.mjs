// Holds the form of the two gate jobs of CI (MOL-375, adversarial В1): the names the ruleset of master
// requires are theirs, and a required job skipped counts as passed. A gate without `if: always()` is
// skipped where a job it waits for fails, and the pull request merges red; one that waits for no job
// passes at once; a job no gate waits for is required by nobody; a step of it that may fail and leave
// the job green — `continue-on-error`, or skipped by an `if:` of its own — lets it pass red too
// (adversarial Г1), and so does a job of `continue-on-error`, whose failure reaches its gate as
// `success` (Д1). Each gate runs this first and reads both, so the one whose `if: always()` went is
// named by the other, which runs.
//
//   node bin/check-ci-gates.mjs

import { readFileSync } from 'node:fs'
import process from 'node:process'

const WORKFLOW = '.github/workflows/ci.yml'

// The checks the ruleset of master requires (MOL-164), each the name of a gate.
const GATES = ['format, lint, types, tests', 'end-to-end']

const RESULTS = "RESULTS: ${{ join(needs.*.result, ' ') }}"
const LOOP = 'for result in ${RESULTS:-none}; do [ "$result" = success ] || exit 1; done'
const COMMAND = 'node bin/check-ci-gates.mjs'
const SELF = `run: ${COMMAND}`

/** The jobs of a workflow: the key, the block, and its `name`, `if` and `needs` at the job's level. */
function jobsOf(workflow) {
  const body = workflow.slice(Math.max(workflow.search(/^jobs:\n/m), 0))
  const heads = [...body.matchAll(/^ {2}([\w-]+):\n/gm)]
  return heads.map((head, i) => {
    const text = body.slice(head.index, heads[i + 1]?.index)
    const needs = /^ {4}needs: (?:\[([^\]]*)\]|([\w-]+))[\t ]*$/m.exec(text)
    return {
      key: head[1],
      text,
      name: /^ {4}name: (.+?)[\t ]*$/m.exec(text)?.[1],
      when: /^ {4}if: (.+?)[\t ]*$/m.exec(text)?.[1],
      needs: needs
        ? (needs[1] ?? needs[2])
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean)
        : [],
    }
  })
}

/** What is wrong with the gates of the workflow, in sentences; empty when both hold. */
export function gateProblems(workflow) {
  const jobs = jobsOf(workflow)
  const problems = []
  const gates = []
  for (const name of GATES) {
    const named = jobs.filter((job) => job.name === name)
    if (named.length !== 1) {
      problems.push(`«${name}» is the name of ${String(named.length)} jobs, not one`)
      continue
    }
    const [gate] = named
    gates.push(gate)
    if (gate.when !== 'always()') {
      problems.push(
        `«${name}» runs without \`if: always()\`: skipped where a job it waits for fails, and passed`,
      )
    }
    if (gate.needs.length === 0) problems.push(`«${name}» waits for no job, and passes at once`)
    if (!gate.text.includes(RESULTS) || !gate.text.includes(LOOP)) {
      problems.push(
        `«${name}» is not red unless all it waits for succeeded: \`${RESULTS}\`, \`${LOOP}\``,
      )
    }
    if (!gate.text.includes(SELF)) problems.push(`«${name}» does not run \`${COMMAND}\``)
    if (/^ {6,}(?:- +)?(?:continue-on-error|if):/m.test(gate.text)) {
      problems.push(
        `«${name}» has a step that may fail or be skipped and leave it green: ` +
          'no `continue-on-error`, no `if:` of a step',
      )
    }
  }
  for (const job of jobs.filter((job) => /^ {4}continue-on-error:/m.test(job.text))) {
    problems.push(
      `\`${job.key}\` runs with \`continue-on-error\`: failed, it reaches its gate as success`,
    )
  }
  const gateKeys = new Set(gates.map((gate) => gate.key))
  for (const gate of gates) {
    for (const key of gate.needs) {
      if (gateKeys.has(key) || !jobs.some((job) => job.key === key)) {
        problems.push(
          `«${String(gate.name)}» waits for \`${key}\`, which is no job of its own to gather`,
        )
      }
    }
  }
  if (gates.length === GATES.length) {
    for (const job of jobs.filter((job) => !gateKeys.has(job.key))) {
      const by = gates.filter((gate) => gate.needs.includes(job.key)).length
      if (by !== 1) problems.push(`\`${job.key}\` is waited for by ${String(by)} gates, not one`)
    }
  }
  return problems
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const problems = gateProblems(readFileSync(WORKFLOW, 'utf8'))
  if (problems.length > 0) {
    console.error(`the gates of ${WORKFLOW} (MOL-375):`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  }
}
