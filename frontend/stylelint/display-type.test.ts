// @vitest-environment node
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'
import { roleMixins } from './display-type.mjs'

const config = {
  plugins: [fileURLToPath(new URL('./display-type.mjs', import.meta.url))],
  customSyntax: 'postcss-scss',
  rules: { 'molvia/display-type-whole': true },
}

async function refused(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({ code, config })
  return (results[0]?.warnings ?? []).map((warning) => warning.text.split(' ')[0] ?? '')
}

describe('molvia/display-type-whole', () => {
  it('takes a display role that sets its size and spacing', async () => {
    expect(
      await refused('.a { @include display-type; margin: 0; font-size: var(--text-title); }'),
    ).toEqual([])
  })

  it('refuses the face, the weight, the axis or the shorthand set again beside the include', async () => {
    expect(
      await refused(
        '.a {\n  @include display-type;\n  font-weight: var(--weight-regular);\n' +
          "  font-family: var(--font);\n  font-variation-settings: 'wght' 400;\n  font: inherit;\n}",
      ),
    ).toEqual(['font-weight', 'font-family', 'font-variation-settings', 'font'])
  })

  it('refuses them before the include as well', async () => {
    expect(await refused('.a { font-weight: var(--weight-bold); @include display-type; }')).toEqual(
      ['font-weight'],
    )
  })

  it('leaves a nested variant its own face: a sentence in a figure’s place', async () => {
    expect(
      await refused(
        '.a { @include display-type; &.missing { font-family: var(--font); font-weight: var(--weight-medium); } }',
      ),
    ).toEqual([])
  })

  it('does not touch a rule without the include', async () => {
    expect(await refused('.a { @include appear; font-weight: var(--weight-bold); }')).toEqual([])
  })

  it('refuses a nested variant that changes the weight and stays in Nunito', async () => {
    expect(
      await refused(
        '.a { @include display-type; &.small { font-weight: var(--weight-regular); } }',
      ),
    ).toEqual(['font-weight'])
  })

  it('reads the media queries of the role: the same element on a wider screen', async () => {
    expect(
      await refused(
        '.a { @include display-type; @include wider-than-phone { font-weight: var(--weight-regular); } ' +
          '@media (width >= 40rem) { font-variation-settings: normal; } }',
      ),
    ).toEqual(['font-weight', 'font-variation-settings'])
  })

  it('refuses all: unset beside the include', async () => {
    expect(await refused('.a { @include display-type; all: unset; }')).toEqual(['all'])
  })

  it('reads a mixin that wraps the role as the role, in the same file', async () => {
    expect(
      await refused(
        '@mixin figure-type { @include display-type; font-variant-numeric: tabular-nums; }\n' +
          '.a { @include figure-type; font-weight: var(--weight-regular); }',
      ),
    ).toEqual(['font-weight'])
  })

  it('learns the wrappers of the role through any number of them', () => {
    expect([
      ...roleMixins(
        '@mixin a { @include display-type; }\n@mixin b { @include a; }\n@mixin c { @include touch-target; }',
      ),
    ]).toEqual(['display-type', 'a', 'b'])
  })

  it('takes only the text face as a face of its own: inherit keeps Nunito', async () => {
    expect(
      await refused(
        '.a { @include display-type; .unit { font-family: inherit; font-weight: var(--weight-regular); } }',
      ),
    ).toEqual(['font-family', 'font-weight'])
  })

  it('refuses the role in a placeholder, where @extend would carry it out of sight', async () => {
    expect(await refused('%display { @include display-type; }')).toEqual(['display-type'])
  })
})
