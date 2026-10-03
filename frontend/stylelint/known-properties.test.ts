// @vitest-environment node
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

const config = {
  plugins: [fileURLToPath(new URL('./known-properties.mjs', import.meta.url))],
  customSyntax: 'postcss-scss',
  rules: { 'molvia/known-custom-property': true },
}

async function unknown(code: string): Promise<string[]> {
  const { results } = await stylelint.lint({ code, config })
  return (results[0]?.warnings ?? []).map((warning) => warning.text.split(' ')[0] ?? '')
}

describe('molvia/known-custom-property', () => {
  it('takes a token of either scheme, and one main.scss or a mixin declares', async () => {
    expect(
      await unknown(
        '.a { gap: var(--space-4); color: var(--cat-own-7); width: var(--weight-display); ' +
          'animation: x var(--appear-duration); }',
      ),
    ).toEqual([])
  })

  it('refuses a name nobody declares, a fallback or not', async () => {
    expect(await unknown('.a { width: var(--space-5); height: var(--space-5, 1rem); }')).toEqual([
      '--space-5',
      '--space-5',
    ])
  })

  it('takes a property the file declares itself', async () => {
    expect(
      await unknown(
        '.bar { --bar-colour: var(--accent); } .fill { background: var(--bar-colour); }',
      ),
    ).toEqual([])
  })

  it('takes a property a script sets, from the one list', async () => {
    expect(await unknown('.sheet { opacity: calc(1 - var(--sheet-drag, 0)); }')).toEqual([])
  })

  it('reads the arguments of a mixin', async () => {
    expect(await unknown('.a { @include appear(var(--space-7)); }')).toEqual(['--space-7'])
  })

  it('reads a name inside calc and with spaces before it', async () => {
    expect(await unknown('.a { top: calc(var(--bar-height) + var( --dock-hight)); }')).toEqual([
      '--dock-hight',
    ])
  })
})
