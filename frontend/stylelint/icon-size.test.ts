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
    (warning) =>
      warning.text.split(
        / on an icon| has no| is sized by| is declared| is worn by| on <[\w-]+> \(line| outside _tokens/,
      )[0] ?? '',
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
          '<IconChevron class="chevron" />\n<a class="leave"><IconInfo class="entry entry-icon" /></a>',
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

  it('refuses a class an icon shares with text or a dot, and checks its rules as an icon’s (замечание 11, В2)', async () => {
    expect(
      await refused(
        sfc(
          `<IconX class="lead muted accent" /><p class="muted" /><span class="dot accent" />`,
          `.lead { ${ICON} }\n.muted { font-size: var(--text-footnote); }\n` +
            '.dot.accent { width: var(--space-2); }',
        ),
      ),
    ).toEqual([
      'font-size: var(--text-footnote)',
      'width: var(--space-2)',
      '.muted',
      '.accent',
      'The icon «.lead.muted.accent» (line 2)',
    ])
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

  it('a class from :class is checked as the icon’s, and sizes nothing', async () => {
    expect(
      await refused(
        sfc(
          '<AppCard><IconChevron :class="{ chevron: true }" /></AppCard>',
          '.chevron { width: 1.25rem; }',
        ),
      ),
    ).toEqual(['width: 1.25rem', '<IconChevron> (line 2)'])
  })
})

describe('molvia/icon-size, round 3', () => {
  it('refuses a step of the scale declared again in a component (В1)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="row"><IconChevron class="chevron" /></p>',
          `.chevron { ${ICON} --icon: 2rem; }\n.row { --icon-md: 2rem; --state-glyph: 1px; --bar-colour: red; }`,
        ),
      ),
    ).toEqual(['--icon', '--icon-md', '--state-glyph'])
  })

  it('refuses a class an icon shares with anything else (В2)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="strip big">text <IconCloud class="big" /></p>',
          '.strip svg { @include icon; font-size: var(--icon-sm); }\n.strip .big { width: 2rem; }',
        ),
      ),
    ).toEqual(['width: 2rem', '.big'])
  })

  it('takes the pair only from a rule that reaches the icon in the template (В3)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="row"><IconChevron class="chevron" /></p>\n<p class="hint"><IconInfo /></p>\n' +
            '<p class="note"><span><IconCloud /></span></p>',
          `.card .chevron { ${ICON} }\nbutton svg { ${ICON} }\n.note > svg { ${ICON} }`,
        ),
      ),
    ).toEqual(['The icon «.chevron» (line 2)', '<IconInfo> (line 3)', '<IconCloud> (line 4)'])
  })

  it('takes a pair under an attribute, a state class of no element or a structural pseudo-class for none (В3)', async () => {
    expect(
      await refused(
        sfc(
          '<button class="row"><IconChevron class="a" /></button>\n<button class="row"><IconChevron class="b" /></button>\n' +
            '<p><IconChevron class="c" /></p>',
          `.row[aria-expanded='true'] .a { ${ICON} }\n.row.is-open .b { ${ICON} }\n.c:first-child { ${ICON} }`,
        ),
      ),
    ).toEqual(['The icon «.a» (line 2)', 'The icon «.b» (line 3)', 'The icon «.c» (line 4)'])
  })

  it('reaches through tags and the child combinator; a class from a variable is named nowhere', async () => {
    expect(
      await refused(
        sfc(
          '<p class="note"><IconCloud /></p>\n<div :class="tone"><IconInfo /></div>\n<button><IconCheck /></button>',
          `.note > svg { ${ICON} }\n.warn svg { ${ICON} }\nbutton svg { ${ICON} }`,
        ),
      ),
    ).toEqual(['<IconInfo> (line 3)'])
  })

  it('leaves to the component only the slot of one that sizes it; Transition renders nothing (В4, замечание 15)', async () => {
    expect(
      await refused(
        sfc(
          '<RouterLink to="/"><IconX /></RouterLink>\n<AppCard><IconY /></AppCard>\n' +
            '<p class="hint"><Transition><IconCheck v-if="ok" /></Transition></p>\n' +
            '<AppButton><template #icon><IconPlus /></template></AppButton>',
          '.x { color: red; }',
        ),
      ),
    ).toEqual(['<IconX> (line 2)', '<IconY> (line 3)', '<IconCheck> (line 4)'])
  })

  it('checks every icon on a line, not the first alone (замечание 16)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="strip"><IconX />x</p><p class="note"><IconY />y</p>',
          '.strip svg { @include icon; font-size: var(--icon-sm); }',
        ),
      ),
    ).toEqual(['<IconY> (line 2)'])
  })

  it('takes the last font-size of the file for the element around, as the cascade does (В5)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="note"><IconInfo /></p>',
          '.note { font-size: var(--icon-sm); svg { @include icon; } }\n.note { font-size: var(--text-display); }',
        ),
      ),
    ).toEqual(['«svg»', '<IconInfo> (line 2)'])
  })

  it('refuses a translate in depth, lets a flat one through (В5)', async () => {
    expect(
      await refused(
        sfc(
          '<IconChevron class="chevron" />',
          `.chevron { ${ICON} translate: 0 0 3.75rem; }\n.chevron.flat { translate: 1px 2px; }`,
        ),
      ),
    ).toEqual(['translate: 0 0 3.75rem'])
  })
})

describe('molvia/icon-size, round 4', () => {
  it('takes :not() of classes, :root and :is() of no state for no condition (review 17, Г5)', async () => {
    expect(
      await refused(
        sfc(
          '<li class="row"><IconX class="a" /></li><p><IconX class="b" /><IconX class="c" /></p>',
          `.row:not(.gone) .a { ${ICON} }\n:root .b { ${ICON} }\n:is(p, li) .c { ${ICON} }`,
        ),
      ),
    ).toEqual([])
  })

  it('takes a state inside :is(), :not(:hover) and a class from :class for a condition (Г3)', async () => {
    expect(
      await refused(
        sfc(
          '<button class="row"><IconX class="a" /></button>\n<button class="row"><IconX class="b" /></button>\n' +
            '<button class="row" :class="{ \'is-open\': open }"><IconX class="c" /></button>',
          `.row:is(:hover) .a { ${ICON} }\n.row:not(:hover) .b { ${ICON} }\n.row.is-open .c { ${ICON} }`,
        ),
      ),
    ).toEqual(['The icon «.a» (line 2)', 'The icon «.b» (line 3)', 'The icon «.c» (line 4)'])
  })

  it('refuses a step set from the template or under a name Sass builds (Г1)', async () => {
    expect(
      await refused(
        sfc(
          `<p class="row" :style="{ '--icon': big }"><IconX class="a" /></p>`,
          `.a { ${ICON} }\n.row { #{"--icon"}: 2rem; }`,
        ),
      ),
    ).toEqual(['#{"--icon"}', '--icon in a bound style (line 2)'])
  })

  it('checks any rule that reaches an icon, and one on a part of its svg (Г2)', async () => {
    expect(
      await refused(
        sfc(
          '<ul class="list"><li class="row"><IconX class="a" /></li></ul>',
          `.a { ${ICON} }\n.row > * { width: 2rem; }\n.list .row * { font-size: var(--text-display); }\n` +
            '.a path { transform: scale(1.6); }',
        ),
      ),
    ).toEqual([
      'width: 2rem',
      'font-size: var(--text-display)',
      'transform: scale(1.6)',
      'The icon «.a» (line 2)',
    ])
  })

  it('refuses a step around an icon that a condition turns into text (Г4)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="note"><IconInfo /></p>',
          '.note { font-size: var(--icon-sm); svg { @include icon; } ' +
            '@include wider-than-phone { font-size: var(--text-display); } }',
        ),
      ),
    ).toEqual(['«svg»', '<IconInfo> (line 2)'])
  })

  it('leaves to AppButton an icon whose class only colours it (Г5)', async () => {
    expect(
      await refused(
        sfc(
          '<AppButton><IconPlus class="plus" /></AppButton>',
          '.plus { color: var(--accent-ink); }',
        ),
      ),
    ).toEqual([])
  })

  it('takes <slot> for no element, and matches an id (review 18)', async () => {
    expect(
      await refused(
        sfc(
          '<span class="wrap"><slot><IconX /></slot></span>\n<p id="z"><IconY /></p>',
          `.wrap > svg { ${ICON} }\n#other svg { ${ICON} }`,
        ),
      ),
    ).toEqual(['<IconY> (line 3)'])
  })
})

describe('molvia/icon-size, round 5', () => {
  it('reads a shorthand key of :class as a class (review 19)', async () => {
    expect(
      await refused(
        sfc(
          '<IconX class="c" :class="{ big }" /><IconX class="d" :class="{ wide, small: x }" />',
          `.c, .d { ${ICON} }\n.big { width: 2rem; }\n.wide { height: 2rem; }`,
        ),
      ),
    ).toEqual(['width: 2rem', 'height: 2rem'])
  })

  it('lets a rule that reaches an icon by * through with what sizes nothing, a box maximum aside (review 20, Е4)', async () => {
    expect(
      await refused(
        sfc(
          '<div class="row"><IconX class="c" /></div>',
          `.c { ${ICON} }\n.row > * { min-width: 0; max-width: 100%; @include appear(0); }`,
        ),
      ),
    ).toEqual(['max-width: 100%'])
  })

  it('takes a part of an svg for an icon’s only under an icon (review 21)', async () => {
    expect(
      await refused(
        sfc(
          '<svg class="chart"><rect class="bar" /></svg><IconX class="c" />',
          `.chart rect { height: 2px; }\n.c { ${ICON} }\n.c path { height: 2px; }`,
        ),
      ),
    ).toEqual(['height: 2px'])
  })

  it('refuses a custom property whose name Sass builds (Д1)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="row"><IconX class="c" /></p>',
          `$step: --icon;\n.c { ${ICON} }\n.row { #{$step}: 2rem; --#{"ic" + "on"}: 2rem; }`,
        ),
      ),
    ).toEqual(['#{$step}', '--#{"ic" + "on"}'])
  })

  it('takes nothing outside a <Teleport> for an ancestor of what it holds (Д2)', async () => {
    expect(
      await refused(
        sfc(
          '<div class="page"><Teleport to="body"><p class="toast"><IconCheck /></p></Teleport></div>',
          `.page svg { ${ICON} }`,
        ),
      ),
    ).toEqual(['<IconCheck> (line 2)'])
  })

  it('holds no role: a chevron at 27 is on the scale, its place is review’s (Д3, review 22)', async () => {
    expect(
      await refused(
        sfc(
          '<button class="row"><IconChevronRight class="chevron" /><IconStar class="star" /></button>',
          '.chevron { @include icon; font-size: var(--icon-tab); }\n.star { @include icon; font-size: var(--icon-tab); }',
          "import IconChevronRight from '~icons/mdi/chevron-right'\nimport IconStar from '~icons/mdi/star'",
        ),
      ),
    ).toEqual([])
  })

  it('takes the mixin of AppButton for an icon of its slot with a step of its own (Д4)', async () => {
    expect(
      await refused(
        sfc(
          '<AppButton><IconPlus class="plus" /></AppButton>',
          '.plus { font-size: var(--icon-md); }',
        ),
      ),
    ).toEqual([])
  })
})

describe('molvia/icon-size, round 6', () => {
  it('lets a chevron of a button or a pager through at 24: the role is the place’s (review 22, Е3)', async () => {
    expect(
      await refused(
        sfc(
          '<AppButton><IconChevronRight class="n" /></AppButton>\n<p class="pager"><IconChevronRight class="next" /></p>',
          `.n { font-size: var(--icon-md); }\n.next { @include icon; font-size: var(--icon-md); }`,
          "import IconChevronRight from '~icons/mdi/chevron-right'",
        ),
      ),
    ).toEqual([])
  })

  it('refuses a built name only where it could be a step (review 23)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="a" />',
          '.a { @each $c in a, b { --cat-#{$c}: red; } --#{$n}: 1px; --icon-#{$n}: 1px; --state-#{$n}: 1px; }',
        ),
      ),
    ).toEqual(['--#{$n}', '--icon-#{$n}', '--state-#{$n}'])
  })

  it('refuses a step registered by @property outside the tokens (Е1)', async () => {
    expect(
      await refused(
        sfc(
          '<IconX class="c" />',
          `@property --icon { syntax: "<length>"; inherits: false; initial-value: 32px; }\n.c { ${ICON} }`,
        ),
      ),
    ).toEqual(['@property --icon'])
  })

  it('refuses a font-size in the template of the element an icon takes its step from (Е2)', async () => {
    expect(
      await refused(
        sfc(
          '<p class="row" style="font-size: var(--text-display)"><IconX /></p>\n<p class="row" :style="{ fontSize: big }"><IconY /></p>\n' +
            '<p class="row" style="font-size: var(--icon)"><IconZ /></p>',
          '.row { font-size: var(--icon-sm); }\n.row svg { @include icon; }',
        ),
      ),
    ).toEqual(['font-size: var(--text-display)', 'A bound font-size'])
  })

  it('refuses a flex share and a maximum of the box on an icon (Е4)', async () => {
    expect(
      await refused(
        sfc(
          '<IconX class="c" />',
          `.c { ${ICON} max-width: 100%; flex-shrink: 1; flex: 1; }\n.c.ok { flex: none; flex-shrink: 0; max-width: none; }`,
        ),
      ),
    ).toEqual(['max-width: 100%', 'flex-shrink: 1', 'flex: 1'])
  })

  it('takes a disabled <Teleport> for no move (Е5)', async () => {
    expect(
      await refused(
        sfc(
          '<div class="page"><Teleport to="body" disabled><IconCheck /></Teleport></div>',
          `.page svg { ${ICON} }`,
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
