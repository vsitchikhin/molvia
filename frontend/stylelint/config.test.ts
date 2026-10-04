// @vitest-environment node
// The house Stylelint config itself (MOL-171): each rule refuses what it was written for and lets the
// code it must not touch through — through the real .stylelintrc.json, both plugins and its overrides.
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const COMPONENT = `${FRONTEND}src/components/Probe.scss`
const MIXINS = `${FRONTEND}src/styles/_mixins.scss`

async function rules(code: string, codeFilename = COMPONENT): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    codeFilename,
    configFile: `${FRONTEND}.stylelintrc.json`,
  })
  return (results[0]?.warnings ?? []).map((warning) => warning.rule)
}

const ALLOWED = 'declaration-property-value-allowed-list'

describe('frontend/.stylelintrc.json', () => {
  it('lets the kit through: tokens, the mixin, the shorthand inherited', async () => {
    expect(
      await rules(
        '.a {\n  @include display-type;\n\n  font-size: var(--text-entry-sign);\n}\n\n' +
          '.b {\n  border-radius: calc(var(--radius) - var(--segment-inset)) 0 50% var(--radius-pill);\n' +
          '  font: inherit;\n  font-size: 1em;\n  font-weight: var(--weight-medium);\n}\n',
      ),
    ).toEqual([])
  })

  it('refuses the font shorthand with anything but inherit — Nunito or a literal past the mixin', async () => {
    expect(
      await rules(
        '.a {\n  font: 400 13px/1.2 Nunito, sans-serif;\n}\n\n' +
          '.b {\n  font: var(--weight-bold) var(--text-title) var(--font-display);\n}\n',
      ),
    ).toEqual([ALLOWED, ALLOWED])
  })

  it('refuses a colour of text as a size: the browser would drop it', async () => {
    expect(
      await rules(
        '.a {\n  font-size: var(--text-muted);\n}\n\n.b {\n  font-size: var(--text);\n}\n',
      ),
    ).toEqual([ALLOWED, ALLOWED])
  })

  it('lets an icon take a step of its scale, the circle glyph among them (MOL-173)', async () => {
    expect(
      await rules(
        '.a {\n  @include icon;\n\n  font-size: var(--icon-sm);\n}\n\n' +
          '.b {\n  font-size: var(--icon);\n}\n\n.c {\n  font-size: var(--state-glyph);\n}\n',
      ),
    ).toEqual([])
  })

  it('refuses an icon sized by a literal or by a step of spacing', async () => {
    expect(
      await rules('.a {\n  font-size: 1.125rem;\n}\n\n.b {\n  font-size: var(--space-6);\n}\n'),
    ).toEqual([ALLOWED, ALLOWED])
  })

  it('refuses a radius made of a token and a number', async () => {
    expect(await rules('.a {\n  border-radius: calc(var(--radius-mark) * 13);\n}\n')).toEqual([
      ALLOWED,
    ])
  })

  it("refuses Nunito's axis set by hand", async () => {
    expect(await rules(".a {\n  font-variation-settings: 'wght' 400;\n}\n")).toEqual([ALLOWED])
  })

  it('keeps checking the mixins: a literal there would reach every component', async () => {
    expect(
      await rules(
        '@mixin probe {\n  margin: 7px;\n  border-radius: 7px;\n  font-weight: 300;\n}\n',
        MIXINS,
      ),
    ).toEqual([ALLOWED, ALLOWED, ALLOWED])
  })

  it('refuses @extend: it carries a role where no check follows', async () => {
    expect(await rules('%display {\n  margin: 0;\n}\n\n.a {\n  @extend %display;\n}\n')).toEqual([
      'at-rule-disallowed-list',
    ])
  })

  // Caps are the kit's caption, written once (MOL-175, В-1 «б»): 52 copies had grown three spacings.
  // The property is refused, not its value: a value can come through a variable, a map, an
  // interpolation or a custom property, and a check of the text never sees it (adversarial А2, Р2-2).
  it('refuses the case and the caps of letters anywhere but the kit caption', async () => {
    const REFUSED = 'property-disallowed-list'
    const ways = [
      '.a {\n  text-transform: uppercase;\n}\n',
      '.a {\n  TEXT-TRANSFORM: uppercase;\n}\n',
      '$caps: uppercase;\n\n.a {\n  text-transform: $caps;\n}\n',
      "@use 'sass:map';\n\n$case: (caption: uppercase);\n\n.a {\n  text-transform: map.get($case, caption);\n}\n",
      ".a {\n  text-transform: #{'upper' + 'case'};\n}\n",
      '.a {\n  --case: uppercase;\n\n  text-transform: var(--case);\n}\n',
      '.a {\n  font-variant: all-small-caps;\n}\n',
      '.a {\n  font-variant-caps: small-caps;\n}\n',
      ".a {\n  font-feature-settings: 'smcp';\n}\n",
    ]
    for (const code of ways) expect(await rules(code), code).toContain(REFUSED)
    // Figures in columns are another property, and stay everyone's.
    expect(await rules('.a {\n  font-variant-numeric: tabular-nums;\n}\n')).toEqual([])
    const caption = `${FRONTEND}src/components/SectionCaption.vue`
    const sfc = (css: string) =>
      `<template><p /></template>\n\n<style scoped lang="scss">\n${css}</style>\n`
    expect(await rules(sfc('.a {\n  text-transform: uppercase;\n}\n'), caption)).toEqual([])
    // The kit caption keeps every other check: a smooth scroll is refused there too.
    expect(await rules(sfc('.a {\n  scroll-behavior: smooth;\n}\n'), caption)).toEqual([
      'declaration-property-value-disallowed-list',
    ])
  })
})
