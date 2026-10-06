import { readFileSync, readdirSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SkeletonPart from '@/components/SkeletonPart.vue'

function render(props: Record<string, unknown>) {
  return mount(SkeletonPart, { props: props as { kind: 'caption' } })
}

describe('SkeletonPart', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // A caption stands on the ground, as `SectionCaption` does: one bar as wide as the screen asked.
  it('draws a caption as one bar on the ground, as wide as asked', () => {
    const view = render({ kind: 'caption', width: 30 })
    expect(view.classes()).toContain('skeleton-caption')
    expect(view.find('.card').exists()).toBe(false)
    expect(view.findAll('.bar')).toHaveLength(1)
    expect(view.get('.bar').attributes('style')).toBe('width: 30%;')
  })

  it('draws a field as the empty well of a search, with no bar in it', () => {
    const view = render({ kind: 'field' })
    expect(view.classes()).toContain('skeleton-field')
    expect(view.element.childElementCount).toBe(0)
  })

  describe('rows', () => {
    // The typical row (owner's В-3 «б»): a title and a meta of a line each, no tail, no lead.
    it('draws a list card of three short rows by default', () => {
      const view = render({ kind: 'rows' })
      const card = view.get('.skeleton-rows > ul')
      expect(card.classes()).toContain('list')
      expect(view.findAll('li.item')).toHaveLength(3)
      const row = view.get('.row')
      expect(row.findAll('.bar').map((bar) => bar.classes()[1])).toEqual(['title', 'meta'])
      expect(row.find('.circle').exists()).toBe(false)
      expect(row.find('.mark').exists()).toBe(false)
      expect(row.find('.tail').exists()).toBe(false)
      expect(row.find('.chevron').exists()).toBe(false)
    })

    it('draws as many rows as the screen asks', () => {
      expect(render({ kind: 'rows', count: 1 }).findAll('li')).toHaveLength(1)
      expect(render({ kind: 'rows', count: 12 }).findAll('li')).toHaveLength(12)
    })

    // `ListRow` with its icon of 24; `OperationRow` with its circle of 40, its amount and its chevron.
    it.each([
      ['icon', '.mark'],
      ['circle', '.circle'],
    ])('leads with %s where the answer has it', (lead, selector) => {
      const row = render({ kind: 'rows', count: 1, lead }).get('.row')
      expect(row.element.firstElementChild?.matches(selector)).toBe(true)
    })

    it('ends in the amount and the place of the chevron, the chevron last', () => {
      const row = render({ kind: 'rows', count: 1, lead: 'circle', tail: true, next: true }).get(
        '.row',
      )
      expect([...row.element.children].map((part) => part.classList[0])).toEqual([
        'circle',
        'words',
        'tail',
        'chevron',
      ])
      expect(
        row
          .get('.tail')
          .findAll('.bar')
          .map((bar) => bar.classes()[1]),
      ).toEqual(['amount'])
    })

    // An account in another currency has a line under nearly every amount: the screen asks for it,
    // and a line under an amount brings the amount — asked for alone, it was dropped without a word
    // (adversarial А5).
    it('draws the line under the amount when asked, with its amount', () => {
      for (const props of [{ tail: true, under: true }, { under: true }]) {
        const under = render({ kind: 'rows', count: 1, ...props }).get('.tail')
        expect(under.findAll('.bar').map((bar) => bar.classes()[1])).toEqual(['amount', 'under'])
      }
      expect(render({ kind: 'rows', count: 1, tail: true }).find('.under').exists()).toBe(false)
    })

    // Narrow is the answer's: only `OperationRow` makes its `li` the container `row`, and a `ListRow`
    // in a plain `li` stays wide — bars gone narrow under it stood 9 px taller (adversarial А1).
    // Left out, `narrow` is the circle's: a circle of 40 is `OperationRow`'s, which always goes
    // narrow, and forgotten there the bars came 42 px short of the answer at 320 (adversarial Б2).
    it('goes narrow only when the answer does, and with the circle by itself', () => {
      const narrow = (props: Record<string, unknown>) =>
        render({ kind: 'rows', tail: true, ...props })
          .classes()
          .includes('skeleton-narrow')
      expect(narrow({})).toBe(false)
      expect(narrow({ lead: 'icon' })).toBe(false)
      expect(narrow({ narrow: true })).toBe(true)
      expect(narrow({ lead: 'circle' })).toBe(true)
      expect(narrow({ lead: 'circle', narrow: false })).toBe(false)
    })

    it('leaves the meta out when the answer has none', () => {
      const row = render({ kind: 'rows', count: 1, meta: false }).get('.row')
      expect(row.find('.meta').exists()).toBe(false)
      expect(row.findAll('.line')).toHaveLength(1)
    })

    // The widths are the part's cycle, in its style, not the screen's: no bar of a row carries one.
    it('gives the screen no width to set on a row', () => {
      const view = render({ kind: 'rows', lead: 'circle', tail: true, under: true, next: true })
      expect(view.findAll('[style]')).toHaveLength(0)
    })
  })

  // Handoff 77 v2 2a: a caption, the figure, a line — and a plate under them when the answer has one.
  it('draws the card of a sum: a caption, the figure, a line, and the plate when asked', () => {
    const view = render({ kind: 'figure' })
    expect(view.classes()).toEqual(['skeleton-figure'])
    expect(view.find('.skeleton-figure > .card').exists()).toBe(true)
    expect(view.findAll('.bar').map((bar) => bar.classes()[1])).toEqual(['label', 'sum', 'note'])
    expect(view.find('.plate').exists()).toBe(false)
    expect(render({ kind: 'figure', plate: true }).find('.plate').exists()).toBe(true)
  })

  describe('lines', () => {
    it('draws a pair of bars per width, in a card', () => {
      const view = render({ kind: 'lines', widths: [72, 54] })
      expect(view.classes()).toEqual(['skeleton-lines'])
      expect(view.find('.skeleton-lines > .card').exists()).toBe(true)
      expect(view.findAll('.group')).toHaveLength(2)
      expect(view.findAll('.text').map((bar) => bar.attributes('style'))).toEqual([
        'width: 72%;',
        'width: 54%;',
      ])
      expect(view.findAll('.sub')).toHaveLength(2)
    })

    // Over the camera a card is no answer's shape: the scanner's bar stands bare in the viewfinder.
    it('stands bare where a card is not the answer’s shape', () => {
      const view = render({ kind: 'lines', widths: [40], card: false })
      expect(view.find('.card').exists()).toBe(false)
      expect(view.classes()).toContain('skeleton-lines')
      expect(view.findAll('.group')).toHaveLength(1)
    })
  })

  // The part is rendered by the screen that puts it in the frame, so its root carries the screen's
  // scope: a root named `caption` took the size of «Бюджет»'s own captions (adversarial А3), and a root
  // that was `AppCard` carried `card`, `plain` and `list`, which a `.card` of «Графики» reached
  // (adversarial В1). Every class of a root is the part's own.
  it.each([
    ['caption', {}],
    ['field', {}],
    ['rows', {}],
    ['figure', {}],
    ['lines', {}],
    ['lines', { card: false }],
  ])('names the root of %s apart from any class of a screen', (kind, props) => {
    const root = render({ kind, ...props }).classes()
    expect(root.length).toBeGreaterThan(0)
    expect(root.filter((name) => !name.startsWith('skeleton-'))).toEqual([])
  })

  it.each([
    ['a kind it has not got', { kind: 'ring' }],
    ['a caption of no width', { kind: 'caption', width: 0 }],
    ['a caption past the whole', { kind: 'caption', width: 101 }],
    ['no rows', { kind: 'rows', count: 0 }],
    ['half a row', { kind: 'rows', count: 1.5 }],
    ['a lead it has not got', { kind: 'rows', lead: 'dot' }],
    ['no lines', { kind: 'lines', widths: [] }],
    ['a line as a word', { kind: 'lines', widths: ['72'] }],
  ])('refuses %s', (_, props) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    render(props)
    expect(warn.mock.calls.some(([message]) => String(message).includes('Invalid prop'))).toBe(true)
  })

  // The part is rendered by the screen that puts it in the frame, so a scoped rule of any screen on a
  // class of its root reaches it: «Настройки» drew their own fields as `.skeleton-field`, the search
  // well's root, and its corners went 14 px (adversarial Б1). The roots are read from the part's
  // template, the classes from every other component's styles — the rule held by this, not by memory.
  it('names no root a class any other component styles', () => {
    const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
    const part = source('./SkeletonPart.vue')
    const template = part.slice(0, part.indexOf('<script'))
    const roots = [...template.matchAll(/(?:class="|')(skeleton-[a-z-]+)/g)].map((m) => m[1] ?? '')
    expect(roots).toEqual(expect.arrayContaining(['skeleton-caption', 'skeleton-narrow']))
    const SOURCES = '../'
    const clashes = readdirSync(new URL(SOURCES, import.meta.url), { recursive: true })
      .map(String)
      .filter((path) => path.endsWith('.vue') && !path.endsWith('SkeletonPart.vue'))
      .flatMap((path) => {
        const sfc = source(`${SOURCES}${path}`)
        // The frame's `:slotted()` places the parts on purpose: that is no screen's own rule.
        const styles = sfc.slice(sfc.indexOf('<style')).replace(/:slotted\([^)]*\)/g, '')
        return roots
          .filter((root) => new RegExp(`\\.${root}(?![\\w-])`).test(styles))
          .map((root) => `${path} .${root}`)
      })
    expect(clashes).toEqual([])
  })
})
