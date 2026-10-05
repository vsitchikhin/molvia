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

/** What the config says of the template, by rule: `[ruleId, message]`. */
async function said(template: string): Promise<[string | null, string][]> {
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
    return { t, sending: ref(false), cond: ref(true) }
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
  return messages.map((message) => [message.ruleId, message.message])
}

async function refused(template: string): Promise<boolean> {
  return (await said(template)).some(([, message]) => message === MESSAGE)
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
    // Р3-А2: a template with nothing in it is a computed string too.
    ['in an object, a template', button('v-bind="{ [`busy`]: sending }"')],
    // Р4-А1: what the `v-bind` gives the button another way — a spread, a choice, a cast.
    ['spread into the object', button('v-bind="{ ...{ busy: sending } }"')],
    ['on one side of a choice', button('v-bind="cond ? { busy: sending } : {}"')],
    ['a choice spread into the object', button('v-bind="{ ...(cond ? { busy: sending } : {}) }"')],
    ['in an object cast', button('v-bind="{ busy: sending } as Record<string, unknown>"')],
    // Р4-А2: a word that says nothing.
    ['with an empty word', button(':busy="sending" busy-label=""')],
    ['with a word of an ellipsis', button(':busy="sending" busy-label="…"')],
    // A word of an element in its slot is not the button's (self-review, round 4).
    [
      'with a word in its slot only',
      `<AppButton :busy="sending"><span :busy-label="${WORD}" /></AppButton>`,
    ],
    // Р3-А2: a word deep in the object is no prop of the button.
    [
      'with a word nested deeper',
      button(`v-bind="{ busy: sending, meta: { busyLabel: ${WORD} } }"`),
    ],
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

  // `v-on` with an object is no prop: its `busy` would be an event (self-review, round 4).
  it('must not fire: `busy` as an event of `v-on` is no prop', async () => {
    expect(await refused(button('v-on="{ busy: () => undefined }"'))).toBe(false)
  }, 60_000)

  // Р3-А2: a `busy` deep in the object — an argument of `t` — is nothing at work.
  it('must not fire: a `busy` nested deeper in the object is no prop of the button', async () => {
    expect(await refused(button(`v-bind="{ label: t('settings.saving', { busy: 1 }) }"`))).toBe(
      false,
    )
  }, 60_000)

  // Р3-А1: a word written into the markup is untranslated, and that is what is said — the word is
  // there, so the rule of the busy button says nothing.
  it.each([
    ['alone', button('busy-label="Сохраняем…"')],
    ['beside :busy', button(':busy="sending" busy-label="Сохраняем…"')],
  ])(
    'a word of the work written as a string %s is refused as untranslated',
    async (_, template) => {
      const rules = (await said(template)).map(([rule]) => rule)
      expect(rules).toContain('vue/no-bare-strings-in-template')
      expect(await refused(template)).toBe(false)
    },
    60_000,
  )
})
