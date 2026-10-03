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
})
