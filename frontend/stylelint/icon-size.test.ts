// @vitest-environment node
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'
import { iconClasses } from './icon-size.mjs'

const plugin = fileURLToPath(new URL('./icon-size.mjs', import.meta.url))

async function refused(code: string, codeFilename = 'Probe.vue'): Promise<string[]> {
  const { results } = await stylelint.lint({
    code,
    codeFilename,
    config: {
      plugins: [plugin],
      customSyntax: codeFilename.endsWith('.vue') ? 'postcss-html' : 'postcss-scss',
      rules: { 'molvia/icon-size': true },
    },
  })
  return (results[0]?.warnings ?? []).map((warning) => warning.text.split(' on an icon')[0] ?? '')
}

const sfc = (template: string, style: string): string =>
  `<template>\n${template}\n</template>\n\n<style scoped lang="scss">\n${style}\n</style>\n`

describe('molvia/icon-size', () => {
  it('refuses a size typed on a class an icon wears, a literal or a step of spacing', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" aria-hidden="true" />\n<IconInfo class="lead note" />',
          '.chevron { width: 1.25rem; height: 1.25rem; }\n.note { inline-size: var(--space-6); }',
        ),
      ),
    ).toEqual(['width: 1.25rem', 'height: 1.25rem', 'inline-size: var(--space-6)'])
  })

  it('lets the icon through as the mixin draws it: 1em, its step as font-size', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />',
          '.chevron { width: 1em; height: 1em; font-size: var(--icon); color: var(--text-muted); }',
        ),
      ),
    ).toEqual([])
  })

  it('reads svg as an icon wherever it ends a selector, :deep opened', async () => {
    expect(
      await refused(
        sfc(
          '<p class="strip"><IconCloud /></p>',
          '.strip svg { width: var(--space-4); }\n' +
            '.note { svg { min-height: 1rem; } }\n' +
            '.glyph :deep(svg) { max-width: 2rem; }',
        ),
      ),
    ).toEqual(['width: var(--space-4)', 'min-height: 1rem', 'max-width: 2rem'])
  })

  it('takes a self-closing <component :is> for an icon, a container for none', async () => {
    expect(
      await refused(
        sfc(
          '<component :is="row.icon" class="entry-icon" />\n' +
            '<component :is="as" class="card"><span class="dot" /></component>',
          '.entry-icon { width: var(--space-6); }\n.card { min-height: 4rem; }\n' +
            '.dot { width: 0.625rem; height: 0.625rem; }',
        ),
      ),
    ).toEqual(['width: var(--space-6)'])
  })

  it('follows & down from an icon rule, through a media query too', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="removed-icon turn" />',
          '.removed-icon { &.turn { width: 2rem; } @media (width >= 40rem) { &.wide { height: 2rem; } } }',
        ),
      ),
    ).toEqual(['width: 2rem', 'height: 2rem'])
  })

  it('leaves alone what no icon wears: a circle around one, a dot, a chart', async () => {
    expect(
      await refused(
        sfc(
          '<span class="circle"><IconCheck class="circle-icon" /></span>\n<span class="svg-frame" />',
          '.circle { width: var(--state-circle); height: var(--state-circle); }\n' +
            '.svg-frame { width: 13.25rem; }',
        ),
      ),
    ).toEqual([])
  })

  it('in a stylesheet with no template, reads only svg', async () => {
    expect(
      await refused('svg { width: 1rem; }\n.chevron { width: 1rem; }\n', 'probe.scss'),
    ).toEqual(['width: 1rem'])
  })

  it('does not see a class bound by :class — a named limit', async () => {
    expect(
      await refused(
        sfc('<IconChevron :class="{ chevron: true }" />', '.chevron { width: 1.25rem; }'),
      ),
    ).toEqual([])
  })
})

describe('iconClasses', () => {
  it('takes the static classes of icon tags only', () => {
    expect([
      ...iconClasses(
        sfc(
          '<AppButton><template #icon><IconPlus class="plus" /></template></AppButton>\n' +
            '<IconMenuDown\n  class="currency-caret"\n  aria-hidden="true"\n/>\n' +
            '<component :is="glyph" class="glyph" />\n' +
            '<component :is="as" class="card" />\n<span class="dot" />',
          '',
        ),
      ),
    ]).toEqual(['plus', 'currency-caret', 'glyph', 'card'])
  })
})
