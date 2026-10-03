// @vitest-environment node
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'
import { iconTags } from './icon-size.mjs'

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
  return (results[0]?.warnings ?? []).map(
    (warning) => warning.text.split(/ on an icon| has no/)[0] ?? '',
  )
}

const sfc = (template: string, style: string, script = ''): string =>
  `<template>\n${template}\n</template>\n\n<script lang="ts">\n${script}\n</script>\n\n` +
  `<style scoped lang="scss">\n${style}\n</style>\n`

// The icon as the kit draws it: the mixin, a step.
const ICON = '@include icon;\n\n  font-size: var(--icon);'

describe('molvia/icon-size', () => {
  it('refuses a size typed on a class an icon wears, a literal or a step of spacing', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" aria-hidden="true" />\n<IconInfo class="lead note" />',
          `.chevron { ${ICON} width: 1.25rem; height: 1.25rem; }\n` +
            `.note { ${ICON} inline-size: var(--space-6); }`,
        ),
      ),
    ).toEqual(['width: 1.25rem', 'height: 1.25rem', 'inline-size: var(--space-6)'])
  })

  it('lets the icon through as the mixin draws it, the mixin and the step in rules of its classes', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />\n<IconInfo class="entry entry-icon" />',
          `.chevron { ${ICON} width: 1em; height: 1em; color: var(--text-muted); }\n` +
            '.entry, .other { @include icon; }\n.leave .entry-icon { font-size: var(--icon-md); }',
        ),
      ),
    ).toEqual([])
  })

  describe('an icon off the scale for want of a line (А1)', () => {
    it('a step without the mixin: unplugin-icons draws 1.2em, a chevron of 24', async () => {
      expect(
        await refused(
          sfc('<IconChevron class="chevron" />', '.chevron { font-size: var(--icon); }'),
        ),
      ).toEqual(['The icon «.chevron» (line 2)'])
    })

    it('the mixin without a step: the icon is the text it stands in', async () => {
      expect(
        await refused(sfc('<IconChevron class="chevron" />', '.chevron { @include icon; }')),
      ).toEqual(['The icon «.chevron» (line 2)'])
    })

    it('a class wearing no rule at all', async () => {
      expect(
        await refused(sfc('<IconChevron class="chevron" />', '.other { color: red; }')),
      ).toEqual(['The icon «.chevron» (line 2)', 'The icon «.chevron» (line 2)'])
    })

    it('a step of text, 1em or inherit as the font-size of an icon', async () => {
      expect(
        await refused(
          sfc(
            '<IconChevron class="a" /><IconChevron class="b" /><IconChevron class="c" />',
            '.a { @include icon; font-size: var(--text-display); }\n' +
              '.b { @include icon; font-size: 1em; }\n.c { @include icon; font-size: inherit; }',
          ),
        ),
      ).toEqual([
        'font-size: var(--text-display)',
        'font-size: 1em',
        'font-size: inherit',
        'The icon «.a» (line 2)',
        'The icon «.b» (line 2)',
        'The icon «.c» (line 2)',
      ])
    })

    it('a rule on svg with one of the pair; one with neither only colours an icon', async () => {
      expect(
        await refused(
          sfc(
            '<p class="strip"><IconCloud /></p>',
            '.strip svg { font-size: var(--icon-sm); }\n.note svg { @include icon; }\n' +
              '.glyph { font-size: var(--icon-button); :deep(svg) { @include icon; } }\n' +
              '.success svg { color: var(--good-ink); }',
          ),
        ),
      ).toEqual(['«.strip svg»', '«.note svg»'])
    })
  })

  it('reads svg as an icon wherever it ends a selector, :deep opened', async () => {
    expect(
      await refused(
        sfc(
          '<p class="strip"><IconCloud /></p>',
          `.strip svg { ${ICON} width: var(--space-4); }\n` +
            `.note { svg { ${ICON} min-height: 1rem; } }\n` +
            `.glyph :deep(svg) { ${ICON} max-width: 2rem; }`,
        ),
      ),
    ).toEqual(['width: var(--space-4)', 'min-height: 1rem', 'max-width: 2rem'])
  })

  it('looks inside @media, @supports and @include { } of an icon rule (А2)', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />',
          `.chevron { ${ICON}\n  @include wider-than-phone { width: 2rem; }\n` +
            '  @media (width >= 40rem) { height: 2rem; }\n  @supports (display: grid) { padding: 2px; } }',
        ),
      ),
    ).toEqual(['@include wider-than-phone', 'width: 2rem', 'height: 2rem', 'padding: 2px'])
  })

  it('refuses padding, scale and a mixin of its own on an icon (А4, А6)', async () => {
    expect(
      await refused(
        sfc(
          '<IconPencil class="pencil" />',
          `.pencil { ${ICON} padding: var(--space-1); scale: 1.6; transform: scale(2); @include big; }`,
        ),
      ),
    ).toEqual(['padding: var(--space-1)', 'scale: 1.6', 'transform: scale(2)', '@include big'])
  })

  it('lets a turn, no padding and scale 1 through', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />',
          `.chevron { ${ICON} padding: 0; scale: 1; transform: rotate(180deg); }`,
        ),
      ),
    ).toEqual([])
  })

  it('refuses a size written in the template: style, :style, width= (А5)', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" style="width: 2rem" />\n' +
            '<IconChevron class="chevron" :style="{ height: big }" />\n' +
            '<IconChevron class="chevron" width="32" />',
          `.chevron { ${ICON} }`,
        ),
      ),
    ).toEqual(['width: 2rem', 'A size in style', 'width='])
  })

  it('finds an icon however the template writes it (А3)', async () => {
    const style = '.chevron { width: 2rem; }'
    const lost = [
      '<IconChevron v-if="count > 0" class="chevron" />',
      '<icon-chevron class="chevron" />',
      "<IconChevron class='chevron' />",
      '<component :is="glyph" class="chevron"></component>',
    ]
    for (const template of lost) {
      expect(await refused(sfc(template, style)), template).toContain('width: 2rem')
    }
    expect(
      await refused(
        sfc(
          '<ChevronRight class="chevron" />',
          style,
          "import ChevronRight from '~icons/mdi/chevron-right'",
        ),
      ),
    ).toContain('width: 2rem')
  })

  it('takes a <component :is> that holds something for no icon', async () => {
    expect(
      await refused(
        sfc(
          '<component :is="as" class="card"><span class="dot" /></component>',
          '.card { min-height: 4rem; }',
        ),
      ),
    ).toEqual([])
  })

  it('resolves the nesting: &-suffix glued to its parent, :is() read inside (А7)', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="row-chevron" /><IconInfo class="info" />',
          `.row { &-chevron { ${ICON} width: 2rem; } }\n:is(.info, .other) { ${ICON} height: 2rem; }`,
        ),
      ),
    ).toEqual(['width: 2rem', 'height: 2rem'])
  })

  it('leaves alone what no icon wears: a wrapper by &-suffix, a class named svg, a circle, :not()', async () => {
    expect(
      await refused(
        sfc(
          '<span class="chevron-wrap"><IconChevron class="chevron" /></span>\n<span class="svg" />\n' +
            '<span class="circle"><IconCheck class="glyph" /></span>',
          `.chevron { ${ICON} &-wrap { width: 2rem; } }\n.svg { width: 2rem; }\n` +
            `.glyph { ${ICON} }\n.circle { width: var(--state-circle); }\n.x:not(.glyph) { width: 2rem; }`,
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

describe('iconTags', () => {
  it('takes the icons of the template, their static classes and lines', () => {
    expect(
      iconTags(
        sfc(
          '<AppButton><template #icon><IconPlus class="plus" /></template></AppButton>\n' +
            '<!-- <IconOld class="old" /> -->\n' +
            '<IconMenuDown\n  v-if="n > 0"\n  class="currency-caret"\n/>\n' +
            '<component :is="glyph" class="glyph" />\n<component :is="as" class="card"><b /></component>\n' +
            '<span class="dot" />',
          '',
        ),
      ).map((tag) => [tag.classes.join(' '), tag.line]),
    ).toEqual([
      ['plus', 2],
      ['currency-caret', 4],
      ['glyph', 8],
    ])
  })
})
