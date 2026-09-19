import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { VERDICT_LEVEL } from '@molvia/model'
import type { VerdictLevel } from '@molvia/model'
import en from '@/i18n/en.json'
import { createAppI18n } from '@/i18n'
import VerdictBadge from '@/components/VerdictBadge.vue'
import source from '@/components/VerdictBadge.vue?raw'

const LEVELS = Object.values(VERDICT_LEVEL)

function render(level: VerdictLevel, compact = false) {
  return mount(VerdictBadge, {
    props: { level, compact },
    global: { plugins: [createAppI18n('en')] },
  })
}

describe('VerdictBadge', () => {
  it.each([
    ['take', en.advice.badge_take],
    ['if_cheap', en.advice.badge_if_cheap],
    ['never', en.advice.badge_never],
  ] as const)('prints the word of %s', (level, word) => {
    expect(render(level).text()).toBe(word)
  })

  // The checklist of the handoff: a greyscale screenshot still tells the three apart. What does
  // that is the shape and the icon, so those are what differ.
  it('tells the three levels apart without colour', () => {
    const shapes = LEVELS.map((level) => render(level).classes().sort().join(' '))
    const icons = LEVELS.map((level) => render(level).get('svg').html())
    expect(new Set(shapes).size).toBe(3)
    expect(new Set(icons).size).toBe(3)
  })

  it('strikes the word through only for «never»', () => {
    expect(render('never').classes()).toContain('struck')
    expect(render('if_cheap').classes()).not.toContain('struck')
    expect(render('take').classes()).not.toContain('struck')
  })

  it('hides the icon from a screen reader when the word is there', () => {
    const view = render('take')
    expect(view.get('svg').attributes('aria-hidden')).toBe('true')
    expect(view.attributes('role')).toBeUndefined()
  })

  // The circle has no word to read, so it is an image named by the full phrase.
  it.each([
    ['take', en.advice.group_take],
    ['if_cheap', en.advice.group_if_cheap],
    ['never', en.advice.group_never],
  ] as const)('names the compact %s by the full phrase', (level, name) => {
    const view = render(level, true)
    expect(view.attributes('role')).toBe('img')
    expect(view.attributes('aria-label')).toBe(name)
    expect(view.text()).toBe('')
  })

  // Terracotta means «tap here»; in results it would read as a promoted item.
  it('never uses the accent', () => {
    const style = source.slice(source.indexOf('<style'))
    expect(style).not.toMatch(/--accent/)
  })

  // 22 in a row, 24 beside a group's title in «What to buy».
  it('draws the circle a size up beside a group title', () => {
    const view = mount(VerdictBadge, {
      props: { level: 'take', compact: true, large: true },
      global: { plugins: [createAppI18n('en')] },
    })
    expect(view.classes()).toEqual(expect.arrayContaining(['dot', 'large']))
  })

  it('must not fire: «large» means nothing to the pill', () => {
    const view = mount(VerdictBadge, {
      props: { level: 'take', large: true },
      global: { plugins: [createAppI18n('en')] },
    })
    expect(view.classes()).not.toContain('large')
  })
})
