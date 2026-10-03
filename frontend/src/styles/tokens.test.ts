import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The colours that can meet on a screen, held apart (MOL-172, Ф-1…Ф-3). Two roles that look alike
 * say two things at once — in the dark scheme «можно нажать» and «плохо» were one salmon — and a
 * mark of data drawn in a decorative grey is not seen. Every pair is checked, none is excused: a
 * value that fails is changed in `_tokens.scss` (owner's В-13, MOL-118).
 */

// A path in a variable: Vite rewrites `new URL('./literal', import.meta.url)` into an asset's address.
const TOKENS = './_tokens.scss'

// Both kinds of comment out first, in one pass as Sass reads them: a `/*` inside a line comment opens
// nothing, and a `//` inside a block comment ends nothing. A value in either is no token, and Sass
// drops it from what the page draws.
const source = readFileSync(new URL(TOKENS, import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\/|(^|[\s;{}])\/\/[^\n]*/g,
  (_comment, before?: string) => before ?? '',
)

// Every declaration, whatever its value: a colour this test cannot read must fail here, not fall out
// of the lists — Stylelint asks for the short hex (`color-hex-length`), and `--fix` writes it.
function declarations(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  )
}

/** The value as `#rrggbb` in lower case, or undefined for anything that is not a hex colour. */
function hex(value: string | undefined): string | undefined {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value ?? '')?.[1]?.toLowerCase()
  if (!digits) return undefined
  return '#' + (digits.length === 3 ? digits.replace(/./g, '$&$&') : digits)
}

const darkAt = source.indexOf('@mixin dark-scheme')
const declared = {
  light: declarations(source.slice(source.indexOf(':root {'), darkAt)),
  dark: declarations(source.slice(darkAt)),
}

// A role is a meaning; its steps are a mark, the same at text size, a fill — and the accent's solid.
const ROLES: Record<string, readonly string[]> = {
  accent: ['accent', 'accent-solid', 'accent-ink', 'accent-tint'],
  good: ['good', 'good-ink', 'good-tint'],
  warn: ['warn', 'warn-ink', 'warn-tint'],
  bad: ['bad', 'bad-ink', 'bad-tint'],
  graphic: ['graphic'],
}
const STEPS = Object.values(ROLES).flat()
const MARKS = ['accent', 'good', 'warn', 'bad', 'graphic']
const TEXT = ['text', 'text-muted', 'accent-ink', 'good-ink', 'warn-ink', 'bad-ink']
const GROUNDS = ['surface', 'sunken', 'surface-2']
// A category is every `--cat-*` but the share of its colour under an icon, which is a percentage.
const CATEGORIES = [...declared.light]
  .filter(([name, value]) => name.startsWith('cat-') && !value.endsWith('%'))
  .map(([name]) => name)
const TINTS = ['accent-tint', 'good-tint', 'warn-tint', 'bad-tint']

const APART = 0.08
const MARK_CONTRAST = 3
const TEXT_CONTRAST = 4.5

function linear(hex: string): [number, number, number] {
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return [channel(1), channel(3), channel(5)]
}

// WCAG 2.x contrast of two colours, whichever is lighter.
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = linear(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

// Euclidean distance in OKLab (Björn Ottosson's matrices): the distance the eye reads, so one number
// means the same for two pale tints and two saturated marks.
function distance(a: string, b: string): number {
  const oklab = (hex: string) => {
    const [r, g, bl] = linear(hex)
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
  }
  const [x, y] = [oklab(a), oklab(b)]
  return Math.hypot(...x.map((v, i) => v - (y[i] ?? 0)))
}

describe.each(['light', 'dark'] as const)('the %s scheme', (scheme) => {
  // The dark block repeats every colour: a name it left out would draw the light value on a dark
  // ground, and the pairs below would be checked against a colour nobody sees.
  const value = (name: string): string => {
    const colour = hex(declared[scheme].get(name))
    if (!colour) throw new Error(`--${name} is no hex colour in the ${scheme} scheme`)
    return colour
  }

  it('declares every colour the pairs are made of, as a hex', () => {
    expect(CATEGORIES.length).toBeGreaterThan(0)
    const unread = [...STEPS, ...TEXT, ...GROUNDS, 'on-accent', ...CATEGORIES]
      .filter((name) => !hex(declared[scheme].get(name)))
      .map((name) => `--${name}: ${declared[scheme].get(name) ?? 'not declared'}`)
    expect(unread).toEqual([])
  })

  it(`holds any two steps of different roles ${String(APART)} apart`, () => {
    const close: string[] = []
    const roles = Object.entries(ROLES)
    for (const [i, [, steps]] of roles.entries())
      for (const [, others] of roles.slice(i + 1))
        for (const a of steps)
          for (const b of others) {
            const d = distance(value(a), value(b))
            if (d < APART) close.push(`--${a} / --${b} ${d.toFixed(3)}`)
          }
    expect(close).toEqual([])
  })

  it(`holds every category ${String(APART)} from every step of a role`, () => {
    const close: string[] = []
    for (const category of CATEGORIES)
      for (const step of STEPS) {
        const d = distance(value(category), value(step))
        if (d < APART) close.push(`--${category} / --${step} ${d.toFixed(3)}`)
      }
    expect(close).toEqual([])
  })

  // A tint is a fill with no edge — a notice in a sheet or a card: one the eye cannot tell from the
  // sheet it lies on is no fill (adversarial А3: the dark bad-tint was 0.038). On the page ground,
  // --sunken, the light good, warn and bad tints stand closer — a strip or a state's circle there is
  // told by its icon and word (review 5, way «а»).
  it(`lays every tint ${String(APART)} apart from --surface`, () => {
    const lost = TINTS.map((tint) => [tint, distance(value(tint), value('surface'))] as const)
      .filter(([, d]) => d < APART)
      .map(([tint, d]) => `--${tint} / --surface ${d.toFixed(3)}`)
    expect(lost).toEqual([])
  })

  it(`draws every mark and category at ${String(MARK_CONTRAST)}:1 on --surface`, () => {
    const faint = [...MARKS, ...CATEGORIES]
      .map((name) => [name, contrast(value(name), value('surface'))] as const)
      .filter(([, ratio]) => ratio < MARK_CONTRAST)
      .map(([name, ratio]) => `--${name} ${ratio.toFixed(2)}:1`)
    expect(faint).toEqual([])
  })

  it(`sets text at ${String(TEXT_CONTRAST)}:1 on every ground it stands on`, () => {
    const pairs: [string, string][] = [
      ...TEXT.flatMap((text) => GROUNDS.map((ground): [string, string] => [text, ground])),
      ...['accent', 'good', 'warn', 'bad'].map((role): [string, string] => [
        `${role}-ink`,
        `${role}-tint`,
      ]),
      ['on-accent', 'accent-solid'],
    ]
    const faint = pairs
      .map(([text, ground]) => [text, ground, contrast(value(text), value(ground))] as const)
      .filter(([, , ratio]) => ratio < TEXT_CONTRAST)
      .map(([text, ground, ratio]) => `--${text} on --${ground} ${ratio.toFixed(2)}:1`)
    expect(faint).toEqual([])
  })
})
