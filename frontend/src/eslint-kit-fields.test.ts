// @vitest-environment node
// The fields of the kit in the house ESLint config itself (MOL-177, MOL-235): a search field, a
// checkbox, an amount typed and a select outside the kit are refused, and each file of the kit keeps
// what is its own — through the real eslint.config.js, linted as text under the name of a file that
// exists, as `eslint-busy.test.ts` does, with no file written.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const eslint = new ESLint({ cwd: FRONTEND })

const SEARCH = 'A search field is SearchField (MOL-177).'
const CHECKBOX = 'A checkbox is AppCheckbox, a switch AppSwitch (MOL-235).'
const AMOUNT = 'An amount is AppField kind="decimal", the large one size="entry" (MOL-235).'
const SELECT = 'A select is AppField kind="select" or CurrencySelect (MOL-235).'

/** The messages of the kit's rules for the template, linted as the file named. */
async function said(template: string, file: string): Promise<string[]> {
  const code = `<template>
  ${template}
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({ name: 'FieldProbe' })
</script>
`
  const [result] = await eslint.lintText(code, { filePath: `${FRONTEND}src/${file}` })
  const messages = result?.messages ?? []
  const fatal = messages.find((message) => message.fatal)
  if (fatal) throw new Error(fatal.message)
  return messages
    .filter(
      (message) =>
        message.ruleId === 'vue/no-restricted-static-attribute' ||
        message.ruleId === 'vue/no-restricted-html-elements',
    )
    .map((message) => message.message)
}

const VIEW = 'views/KitView.vue'

// Each case is a lint of its own through the type-aware parser, the first one building its program:
// seconds here, and a test of seconds takes its own timeout (MOL-243).

describe('the fields of the kit, outside it (MOL-235)', () => {
  it('refuses a copy of each on a screen', async () => {
    expect(await said('<input type="checkbox" />', VIEW)).toEqual([CHECKBOX])
    expect(await said('<input type="text" inputmode="decimal" />', VIEW)).toEqual([AMOUNT])
    expect(await said('<select><option>֏</option></select>', VIEW)).toEqual([SELECT])
    expect(await said('<input type="search" />', VIEW)).toEqual([SEARCH])
  }, 120_000)

  it('must not fire: what is not a copy passes', async () => {
    expect(await said('<input type="text" />', VIEW)).toEqual([])
    expect(await said('<input type="radio" />', VIEW)).toEqual([])
    expect(await said('<input type="text" inputmode="numeric" />', VIEW)).toEqual([])
  }, 120_000)

  it('leaves each file of the kit what is its own, and refuses it the others’', async () => {
    const box = 'components/AppCheckbox.vue'
    expect(await said('<input type="checkbox" />', box)).toEqual([])
    expect(await said('<input type="checkbox" />', 'components/AppSwitch.vue')).toEqual([])
    expect(await said('<input type="search" />', box)).toEqual([SEARCH])
    expect(await said('<input inputmode="decimal" />', box)).toEqual([AMOUNT])

    const search = 'components/SearchField.vue'
    expect(await said('<input type="search" />', search)).toEqual([])
    expect(await said('<input type="checkbox" />', search)).toEqual([CHECKBOX])

    expect(
      await said('<select><option>֏</option></select>', 'components/CurrencySelect.vue'),
    ).toEqual([])
    expect(await said('<select><option>֏</option></select>', 'components/AppField.vue')).toEqual([])
    expect(await said('<input type="checkbox" />', 'components/AppField.vue')).toEqual([CHECKBOX])
  }, 120_000)
})
