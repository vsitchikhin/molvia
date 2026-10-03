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

// Comments out first: a hex in one is no token, and Sass drops it from what the page draws.
const source = readFileSync(new URL(TOKENS, import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

function colours(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  )
}

const darkAt = source.indexOf('@mixin dark-scheme')
const declared = {
  light: colours(source.slice(source.indexOf(':root {'), darkAt)),
  dark: colours(source.slice(darkAt)),
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
const CATEGORIES = [...declared.light.keys()].filter((name) => name.startsWith('cat-'))

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
    const hex = declared[scheme].get(name)
    if (!hex) throw new Error(`--${name} is not declared in the ${scheme} scheme`)
    return hex
  }

  it('declares every colour the pairs are made of', () => {
    expect(CATEGORIES.length).toBeGreaterThan(0)
    const missing = [...STEPS, ...TEXT, ...GROUNDS, 'on-accent', ...CATEGORIES].filter(
      (name) => !declared[scheme].has(name),
    )
    expect(missing).toEqual([])
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
