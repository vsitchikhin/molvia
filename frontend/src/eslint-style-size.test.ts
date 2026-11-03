// @vitest-environment node
// A size of text bound by `:style` in the house ESLint config itself (MOL-334, adversarial Г22): no stylesheet reader
// sees the script of a binding, so a size, the shorthand, an adjustment or a zoom bound there is refused — through
// the real eslint.config.js, linted as text under the name of a file that exists, as `eslint-busy.test.ts` does.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const eslint = new ESLint({ cwd: FRONTEND })

const SIZE =
  'A size of text is the stylesheet’s, never a :style binding — large text would stop at it (MOL-334).'

/** The messages of `vue/no-restricted-syntax` for the template, linted as a component of the app. */
async function said(template: string): Promise<string[]> {
  const code = `<template>
  ${template}
</template>

<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({ name: 'SizeProbe' })
</script>
`
  const [result] = await eslint.lintText(code, {
    filePath: `${FRONTEND}src/components/SectionCaption.vue`,
  })
  const messages = result?.messages ?? []
  const fatal = messages.find((message) => message.fatal)
  if (fatal) throw new Error(fatal.message)
  return messages
    .filter((message) => message.ruleId === 'vue/no-restricted-syntax')
    .map((message) => message.message)
}

// Each case is a lint of its own through the type-aware parser, the first one building its program:
// seconds here, and a test of seconds takes its own timeout (MOL-243).

describe('a size of text bound by :style (MOL-334)', () => {
  it('refuses a size, the shorthand, an adjustment or a zoom, however the binding spells it', async () => {
    for (const binding of [
      `:style="{ fontSize: 'var(--text-tab)' }"`,
      `:style="{ 'font-size': '11px' }"`,
      `:style="{ font: 'inherit' }"`,
      `:style="{ fontSizeAdjust: 0.25 }"`,
      `:style="{ zoom: 0.5 }"`,
      `:style="[{ color: 'red' }, { fontSize: '11px' }]"`,
      `v-bind:style="{ fontSize: '11px' }"`,
      `:style="'font-size: 11px'"`,
      ':style="`color: red; zoom: ${0.5}`"',
    ])
      expect(await said(`<p ${binding} />`), binding).toEqual([SIZE])
  }, 120_000)

  it('must not fire: a custom property, a place, a colour, a family', async () => {
    for (const binding of [
      `:style="{ '--sheet-footer-height': '40px' }"`,
      `:style="{ top: '4px', left: '2px' }"`,
      `:style="{ background: 'var(--cat-own-1)' }"`,
      `:style="{ fontFamily: 'var(--font)' }"`,
      `:style="'--figure-width: 4'"`,
    ])
      expect(await said(`<p ${binding} />`), binding).toEqual([])
  }, 120_000)
})
