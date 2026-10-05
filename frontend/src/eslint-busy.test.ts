// @vitest-environment node
// The rule of a busy button in the house ESLint config itself (MOL-225): `busy` with no word of the
// work is refused however it is written, and a word given however it is written lets it through —
// through the real eslint.config.js, as `stylelint/config.test.ts` holds the Stylelint one. Each case
// is linted as text under the name of a view that exists — the type-aware parser reads only what the
// project knows — with no file written.
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const MESSAGE = 'A busy button says what it does: give it a busy-label (MOL-225).'
const eslint = new ESLint({ cwd: FRONTEND })
const WORD = "t('settings.saving')"

/** A button of the kit with these attributes, its own word inside, on the tag asked for. */
const button = (attributes: string, tag = 'AppButton'): string =>
  `<${tag} ${attributes}>{{ t('item.save') }}</${tag}>`

async function refused(template: string): Promise<boolean> {
  const code = `<template>
  ${template}
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/AppButton.vue'

export default defineComponent({
  name: 'BusyProbe',
  components: { AppButton },
  setup() {
    const { t } = useI18n()
    return { t, sending: ref(false) }
  },
})
</script>
`
  const [result] = await eslint.lintText(code, {
    filePath: `${FRONTEND}src/views/KitView.vue`,
  })
  const messages = result?.messages ?? []
  const fatal = messages.find((message) => message.fatal)
  if (fatal) throw new Error(fatal.message)
  return messages.some((message) => message.message === MESSAGE)
}

describe('eslint.config.js: a busy button says what it does (MOL-225)', () => {
  it.each([
    ['bound', button(':busy="sending"')],
    ['alone', button('busy')],
    ['by v-bind:', button('v-bind:busy="sending"')],
    ['on the kebab tag', button(':busy="sending"', 'app-button')],
    ['in an object', button('v-bind="{ busy: sending }"')],
    // Adversarial Р2-А1: the key of an object in quotes, or computed.
    ['in an object, quoted', button(`v-bind="{ 'busy': sending }"`)],
    ['in an object, computed', button(`v-bind="{ ['busy']: sending }"`)],
  ])(
    'refuses `busy` %s with no word',
    async (_, template) => {
      expect(await refused(template)).toBe(true)
    },
    60_000,
  )

  it.each([
    ['as busy-label', button(`:busy="sending" :busy-label="${WORD}"`)],
    ['on the kebab tag', button(`:busy="sending" :busy-label="${WORD}"`, 'app-button')],
    ['in the object', button(`v-bind="{ busy: sending, busyLabel: ${WORD} }"`)],
    // Р2-А1: the word in quotes is the same prop.
    ['in the object, quoted', button(`v-bind="{ busy: sending, 'busyLabel': ${WORD} }"`)],
    ['beside an object of busy', button(`v-bind="{ 'busy': sending }" :busy-label="${WORD}"`)],
  ])(
    'lets `busy` through with its word %s',
    async (_, template) => {
      expect(await refused(template)).toBe(false)
    },
    60_000,
  )

  it('must not fire: a button that is not busy needs no word', async () => {
    expect(await refused(button(':inactive="sending"'))).toBe(false)
  }, 60_000)
})
