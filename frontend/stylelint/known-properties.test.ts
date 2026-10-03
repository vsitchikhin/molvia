// @vitest-environment node
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'
import { rootNames } from './known-properties.mjs'

const config = {
  plugins: [fileURLToPath(new URL('./known-properties.mjs', import.meta.url))],
  customSyntax: 'postcss-scss',
  rules: { 'molvia/known-custom-property': true },
}

const TOKENS = fileURLToPath(new URL('../src/styles/_tokens.scss', import.meta.url))

async function unknown(code: string, codeFilename?: string): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    config,
    ...(codeFilename ? { codeFilename } : {}),
  })
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

  it('does not check a name Sass builds by interpolation', async () => {
    expect(await unknown('.a { gap: var(--space-#{$step}); }')).toEqual([])
  })

  it('does not take a name from a comment at the end of a declaration', async () => {
    expect(await unknown('.a { --own: 1px; // --later: not yet\n  width: var(--later); }')).toEqual(
      ['--later'],
    )
  })

  it('refuses, in _tokens.scss, a name the dark scheme alone declares', async () => {
    expect(
      await unknown('@mixin dark-scheme {\n  --text: #fff;\n  --probe-ink: #fff;\n}', TOKENS),
    ).toEqual(['--probe-ink'])
  })

  it('does not take a name the dark scheme alone declares as a token elsewhere', async () => {
    expect(await unknown('.a { color: var(--probe-ink); }')).toEqual(['--probe-ink'])
  })

  it('takes globals from a top-level :root only, not from a media query or another selector', () => {
    expect(
      rootNames(
        ':root {\n  --a: 1;\n}\n\n@media (prefers-color-scheme: dark) {\n  :root {\n    --b: 2;\n  }\n}\n\n' +
          'html[data-nav] {\n  --c: 0s;\n}\n\n:root:not([data-scheme]) {\n  --d: 3;\n}\n',
      ),
    ).toEqual(['--a'])
  })
})
