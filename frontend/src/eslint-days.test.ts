// @vitest-environment node
// The screen's day in the house ESLint config itself (MOL-329, self-review №2): a day word counted from
// `localDay()` read in place, and a day held in `ref(localDay())`, are refused in a script and in a
// template — through the real eslint.config.js, linted as text under the name of a file that exists, as
// `eslint-busy.test.ts` does, with no file written.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const eslint = new ESLint({ cwd: FRONTEND })

const IN_PLACE =
  "A day is said from the screen's day — useLocalDay or its today — never localDay() in place (MOL-329)."
const HELD =
  "A screen's day is useLocalDay(): it moves as the app comes back and at midnight (MOL-329)."

async function said(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${FRONTEND}src/${file}` })
  const messages = result?.messages ?? []
  const fatal = messages.find((message) => message.fatal)
  if (fatal) throw new Error(fatal.message)
  return messages
    .filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' || message.ruleId === 'vue/no-restricted-syntax',
    )
    .map((message) => message.message)
}

const script = (body: string) => `import { ref } from 'vue'
import { answeredAt, localDay, purchaseDay } from '@/days'

export function probe(at: Date, today: string): string[] {
  ${body}
}
`

const view = (template: string, setup: string) => `<template>
  <p>${template}</p>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import { answeredAt, localDay } from '@/days'

export default defineComponent({
  name: 'DayProbe',
  setup() {
    ${setup}
    return { answeredAt, localDay, at: new Date() }
  },
})
</script>
`

// Each case is a lint of its own through the type-aware parser, the first one building its program:
// seconds here, and a test of seconds takes its own timeout (MOL-243).

describe('the screen`s day (MOL-329)', () => {
  it('refuses localDay() in place of the screen`s day, in a script', async () => {
    const file = 'composables/usePendingFrom.ts'
    expect(await said(script("return [answeredAt(at, 'ru', localDay())]"), file)).toEqual([
      IN_PLACE,
    ])
    expect(await said(script("return [purchaseDay(at, 'ru', String(localDay()))]"), file)).toEqual([
      IN_PLACE,
    ])
    // The screen's own day passes.
    expect(await said(script("return [answeredAt(at, 'ru', today)]"), file)).toEqual([])
  }, 60_000)

  it('refuses a day held in ref(localDay()) — a script of a component, a module', async () => {
    expect(
      await said(view('{{ 1 }}', 'const today = ref(localDay())'), 'components/AccountSheet.vue'),
    ).toEqual([HELD])
    expect(
      await said(
        script('const today = ref(localDay())\n  return [today.value]'),
        'stores/accounts.ts',
      ),
    ).toEqual([HELD])
  }, 60_000)

  it('refuses localDay() in place in a template', async () => {
    expect(
      await said(view("{{ answeredAt(at, 'ru', localDay()) }}", ''), 'views/AccountsView.vue'),
    ).toEqual([IN_PLACE])
  }, 60_000)

  it('leaves the tests and useLocalDay itself alone', async () => {
    expect(
      await said(
        script("return [answeredAt(at, 'ru', localDay())]"),
        'views/PurchasesView.test.ts',
      ),
    ).toEqual([])
    expect(
      await said(
        script('const today = ref(localDay())\n  return [today.value]'),
        'composables/useLocalDay.ts',
      ),
    ).toEqual([])
  }, 60_000)
})
