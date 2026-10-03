// @vitest-environment node
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'
import { templateTags } from './icon-size.mjs'

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
    (warning) => warning.text.split(/ on an icon| has no| is sized by/)[0] ?? '',
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

  describe('an icon off the scale for want of a line (А1, Б2)', () => {
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

    it('a class wearing no rule at all, nothing above it either', async () => {
      expect(
        await refused(sfc('<IconChevron class="chevron" />', '.other { color: red; }')),
      ).toEqual(['The icon «.chevron» (line 2)'])
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

    it('a line of the pair under a condition is no pair: @media, :hover', async () => {
      expect(
        await refused(
          sfc(
            '<IconChevron class="a" /><IconChevron class="b" />\n<button class="row"><IconChevron class="c" /></button>',
            '.a { font-size: var(--icon); @media (width >= 40rem) { @include icon; } }\n' +
              '.b { @include icon; @media (width >= 40rem) { font-size: var(--icon); } }\n' +
              `.row:hover .c { ${ICON} }`,
          ),
        ),
      ).toEqual(['The icon «.a» (line 2)', 'The icon «.b» (line 2)', 'The icon «.c» (line 3)'])
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
      ).toEqual(['«.strip svg»', '«.note svg»', '<IconCloud> (line 2)'])
    })

    it('the step around a rule on svg is the nearest font-size, and it must be a step', async () => {
      expect(
        await refused(
          sfc(
            '<div class="card"><p class="line"><slot /></p></div>',
            '.card { font-size: var(--icon); .line { font-size: var(--text-display); svg { @include icon; } } }',
          ),
        ),
      ).toEqual(['«svg»'])
    })

    it('takes the step of a rule of the same selector written flat', async () => {
      expect(
        await refused(
          sfc(
            '<span class="glyph"><slot /></span>',
            '.glyph { font-size: var(--icon); }\n.glyph svg { @include icon; }',
          ),
        ),
      ).toEqual([])
    })
  })

  describe('an icon with no class, or one that only colours it, is sized from above (Б1, Б6)', () => {
    it('a bare icon in a paragraph, and one under a rule on svg that only colours it', async () => {
      expect(
        await refused(
          sfc(
            '<p class="hint">\n  <IconInfo aria-hidden="true" />\n</p>\n<p class="note"><IconInfo /></p>',
            '.hint { color: var(--text-muted); }\n.note svg { color: var(--text-muted); }',
          ),
        ),
      ).toEqual(['<IconInfo> (line 3)', '<IconInfo> (line 5)'])
    })

    it('passes one sized by a rule on svg under an element it stands in', async () => {
      expect(
        await refused(
          sfc(
            '<div class="strip"><p><IconCloud /><IconCloud class="lead" /></p></div>',
            '.strip svg { @include icon; font-size: var(--icon-sm); }\n.lead { color: var(--warn-ink); }',
          ),
        ),
      ).toEqual([])
    })

    it('does not take a rule on svg whose context the icon does not stand in', async () => {
      expect(
        await refused(
          sfc(
            '<p class="hint"><IconInfo /></p>',
            '.strip svg { @include icon; font-size: var(--icon-sm); }',
          ),
        ),
      ).toEqual(['<IconInfo> (line 2)'])
    })

    it("leaves an icon in a component's slot to the component", async () => {
      expect(
        await refused(
          sfc(
            '<AppButton><template #icon><IconPlus /></template></AppButton>',
            '.x { color: red; }',
          ),
        ),
      ).toEqual([])
    })
  })

  describe('a class an icon shares with something else names no icon (замечание 11)', () => {
    it('a modifier on text or a dot is theirs; with a class of the icon alone it is the icon’s', async () => {
      expect(
        await refused(
          sfc(
            `<IconX class="lead muted accent" /><p class="muted" /><span class="dot accent" />`,
            `.lead { ${ICON} }\n.muted { font-size: var(--text-footnote); }\n` +
              '.dot.accent { width: var(--space-2); }\n.lead.accent { width: 2rem; }',
          ),
        ),
      ).toEqual(['width: 2rem'])
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

  it('looks inside @media, @supports and @include wider-than-phone { } of an icon rule (А2)', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />',
          `.chevron { ${ICON}\n  @include wider-than-phone { width: 2rem; font-size: var(--icon-md); }\n` +
            '  @media (width >= 40rem) { height: 2rem; }\n  @supports (display: grid) { padding: 2px; } }',
        ),
      ),
    ).toEqual(['width: 2rem', 'height: 2rem', 'padding: 2px'])
  })

  it('refuses what resizes the glyph past the rule: padding, border, scale, zoom, a transform (А4, Б4)', async () => {
    expect(
      await refused(
        sfc(
          '<IconPencil class="pencil" />',
          `.pencil { ${ICON} padding: var(--space-1); border: var(--space-1) solid transparent; ` +
            'scale: 1.6; zoom: 1.6; transform: scale(2); }\n' +
            `.pencil.wide { transform: matrix(1.6, 0, 0, 1.6, 0, 0); border-width: 2px; }`,
        ),
      ),
    ).toEqual([
      'padding: var(--space-1)',
      'border: var(--space-1) solid transparent',
      'scale: 1.6',
      'zoom: 1.6',
      'transform: scale(2)',
      'transform: matrix(1.6, 0, 0, 1.6, 0, 0)',
      'border-width: 2px',
    ])
  })

  it('refuses a mixin of its own on an icon, but icon and wider-than-phone (А6)', async () => {
    expect(
      await refused(sfc('<IconPencil class="pencil" />', `.pencil { ${ICON} @include big; }`)),
    ).toEqual(['@include big'])
  })

  it('lets a turn, a shift, no padding, no border and scale 1 through', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />',
          `.chevron { ${ICON} padding: 0; border: none; scale: 1; zoom: 1; ` +
            'transform: rotate(180deg) translateY(1px); }',
        ),
      ),
    ).toEqual([])
  })

  it('refuses a size written in the template: style, a bound style, v-bind, width= (А5, Б3)', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" style="width: 2rem; font-size: var(--text-display)" />\n' +
            '<IconChevron class="chevron" :style="{ fontSize: big }" />\n' +
            '<IconChevron class="chevron" v-bind="{ width: 32 }" />\n' +
            '<IconChevron class="chevron" width="32" />\n' +
            '<IconChevron v-if="a < b" class="chevron" style="min-width: 2rem" />',
          `.chevron { ${ICON} }`,
        ),
      ),
    ).toEqual([
      'width: 2rem',
      'font-size: var(--text-display)',
      'min-width: 2rem',
      'A bound style',
      'A bound style',
      'width=',
    ])
  })

  it('finds an icon however the template writes it (А3, Б5)', async () => {
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
    const imported = "import ChevronRight from '~icons/mdi/chevron-right'"
    expect(await refused(sfc('<ChevronRight class="chevron" />', style, imported))).toContain(
      'width: 2rem',
    )
    expect(
      await refused(
        sfc(
          '<Chevron class="chevron" />',
          style,
          `${imported}\nexport default defineComponent({ components: { Chevron: ChevronRight } })`,
        ),
      ),
    ).toContain('width: 2rem')
  })

  it('takes no <component :is> for an icon unless it is an icon or a glyph that holds nothing', async () => {
    expect(
      await refused(
        sfc(
          '<component :is="as" class="card"><span class="dot" /></component>\n' +
            '<component :is="as" class="tile" />',
          '.card { min-height: 4rem; }\n.tile { padding: var(--space-4); }',
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
        sfc(
          '<AppCard><IconChevron :class="{ chevron: true }" /></AppCard>',
          '.chevron { width: 1.25rem; }',
        ),
      ),
    ).toEqual([])
  })
})

describe('templateTags', () => {
  it('takes the tags of the template: icons, their static classes, lines and parents', () => {
    const tags = templateTags(
      sfc(
        '<AppButton><template #icon><IconPlus class="plus" /></template></AppButton>\n' +
          '<!-- <IconOld class="old" /> -->\n' +
          '<p class="strip"><IconMenuDown\n  v-if="n > 0"\n  class="currency-caret"\n/></p>\n' +
          '<component :is="glyph" class="glyph" />\n<component :is="as" class="card"><b /></component>\n' +
          '<br><span class="dot" />',
        '',
      ),
    )
    expect(
      tags
        .filter((tag) => tag.icon)
        .map((tag) => [tag.classes.join(' '), tag.line, tag.parent?.name ?? '']),
    ).toEqual([
      ['plus', 2, 'template'],
      ['currency-caret', 4, 'p'],
      ['glyph', 8, ''],
    ])
    expect(tags.find((tag) => tag.name === 'span')?.parent).toBeUndefined()
  })
})
