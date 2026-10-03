// The token block of frontend/DESIGN.md, built from frontend/src/styles/_tokens.scss and never typed
// by hand (MOL-118 В-3, MOL-171). DESIGN.md is what Claude Design draws from; a block copied by hand
// drifts from the tokens at the first edit of either, and the next design is drawn in old colours.
//
// The block is the file's YAML front matter, passed through Prettier with the repository's config —
// otherwise `make format` rewrites its quotes and the check fails on its own output. The prose under
// it is written by hand and never touched here.
//
//   node bin/design-md.mjs                            print the block
//   node bin/design-md.mjs --write frontend/DESIGN.md put it in the file (npm run format)
//   node bin/design-md.mjs --check frontend/DESIGN.md refuse a block that is out of date (npm run lint)

import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import prettier from 'prettier'

const TOKENS = new URL('../frontend/src/styles/_tokens.scss', import.meta.url)

// Both kinds of comment out, a line comment also at the end of a declaration: a value in one is not a
// token, and Sass drops it from the CSS the page draws with.
const scss = readFileSync(TOKENS, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[\s;{}])\/\/[^\n]*/g, '$1')

function block(source, opener) {
  const at = source.indexOf(opener)
  if (at < 0) throw new Error(`no block ${opener}`)
  let depth = 0
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(source.indexOf('{', at) + 1, i)
  }
  throw new Error(`unclosed ${opener}`)
}

function vars(body) {
  const out = new Map()
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim())
  return out
}

const light = vars(block(scss, ':root'))
const dark = vars(block(scss, '@mixin dark-scheme'))

function token(name) {
  const value = light.get(name)
  if (value === undefined) throw new Error(`no token --${name} in _tokens.scss`)
  return value
}

function resolveVar(value) {
  return value.replace(/var\(--([a-z0-9-]+)\)/g, (_, name) => resolveVar(token(name)))
}

const rem = (v) => (/^[\d.]+rem$/.test(v) ? `${Math.round(parseFloat(v) * 16 * 100) / 100}px` : v)
const isColour = (v) => /^(#|rgb|hsl)/.test(v)

const colors = {}
for (const [name, value] of light) if (isColour(value)) colors[name] = value
for (const [name, value] of dark) if (isColour(value)) colors[`${name}-dark`] = value

const pick = (prefix) =>
  Object.fromEntries(
    [...light]
      .filter(([n]) => n.startsWith(prefix))
      .map(([n, v]) => [n.slice(prefix.length).replace(/^-/, '') || 'default', rem(v)]),
  )

// Roles: which size, face, weight and leading each step of the scale is drawn with — every one a
// token, so a weight changed in _tokens.scss changes here too.
const ROLES = {
  display: ['text-display', 'font-display', 'weight-display', 'leading-tight'],
  title: ['text-title', 'font-display', 'weight-display', 'leading-tight'],
  figure: ['text-figure', 'font-display', 'weight-display', 'leading-tight'],
  headline: ['text-headline', 'font', 'weight-medium', 'leading-snug'],
  body: ['text-body', 'font', 'weight-regular', 'leading-body'],
  callout: ['text-callout', 'font', 'weight-regular', 'leading-snug'],
  footnote: ['text-footnote', 'font', 'weight-regular', 'leading-snug'],
  label: ['text-footnote', 'font', 'weight-medium', 'leading-snug'],
  caption: ['text-caption', 'font', 'weight-bold', 'leading-snug'],
}
const typography = Object.fromEntries(
  Object.entries(ROLES).map(([role, [size, face, weight, leading]]) => [
    role,
    {
      fontFamily: [...new Set(resolveVar(token(face)).split(/\s*,\s*/))].join(', '),
      fontSize: rem(token(size)),
      fontWeight: Number(token(weight)),
      lineHeight: Number(token(leading)),
      ...(role === 'caption' ? { letterSpacing: token('tracking-caps') } : {}),
    },
  ]),
)

// The kit's primitives in the spec's eight properties; what they cannot carry (rings, shadows,
// states) is in the prose of DESIGN.md.
const touch = rem(token('touch-target'))
const badge = rem(token('badge-height'))
const components = {
  'button-primary': {
    backgroundColor: '{colors.accent-solid}',
    textColor: '{colors.on-accent}',
    rounded: '{rounded.pill}',
    height: touch,
    padding: '0 16px',
    typography: '{typography.headline}',
  },
  'button-primary-large': {
    backgroundColor: '{colors.accent-solid}',
    textColor: '{colors.on-accent}',
    rounded: '{rounded.pill}',
    height: rem(token('touch-target-lg')),
  },
  'button-secondary': {
    backgroundColor: '{colors.surface}',
    textColor: '{colors.text}',
    rounded: '{rounded.pill}',
    height: touch,
    padding: '0 16px',
  },
  'button-ghost': {
    textColor: '{colors.accent-ink}',
    rounded: '{rounded.pill}',
    height: touch,
    padding: '0 16px',
  },
  'button-danger-ghost': {
    textColor: '{colors.bad-ink}',
    rounded: '{rounded.pill}',
    height: touch,
    padding: '0 16px',
  },
  'button-icon': {
    backgroundColor: '{colors.surface-2}',
    textColor: '{colors.text-muted}',
    rounded: '{rounded.pill}',
    size: touch,
  },
  card: { backgroundColor: '{colors.surface}', rounded: '{rounded.lg}', padding: '16px' },
  field: {
    backgroundColor: '{colors.surface-2}',
    textColor: '{colors.text}',
    rounded: '{rounded.default}',
    height: touch,
    padding: '0 12px',
    typography: '{typography.body}',
  },
  'segmented-track': {
    backgroundColor: '{colors.surface-2}',
    rounded: '{rounded.default}',
    height: touch,
  },
  'verdict-take': {
    backgroundColor: '{colors.good}',
    textColor: '{colors.on-accent}',
    rounded: '{rounded.pill}',
    height: badge,
    typography: '{typography.caption}',
  },
  'verdict-cheap': {
    textColor: '{colors.warn-ink}',
    rounded: '{rounded.pill}',
    height: badge,
    typography: '{typography.caption}',
  },
  'verdict-never': {
    textColor: '{colors.bad-ink}',
    rounded: '{rounded.pill}',
    height: badge,
    typography: '{typography.caption}',
  },
  sheet: { backgroundColor: '{colors.surface}', rounded: '{rounded.sheet}', padding: '16px' },
  'tab-bar': {
    backgroundColor: '{colors.surface}',
    textColor: '{colors.text-muted}',
    height: rem(token('tabbar-height')),
  },
  'tab-active': { textColor: '{colors.accent-ink}' },
}

const q = (v) => (typeof v === 'number' ? String(v) : JSON.stringify(v))
function yaml(obj, indent = 0) {
  const pad = ' '.repeat(indent)
  return Object.entries(obj)
    .map(([k, v]) =>
      v && typeof v === 'object' ? `${pad}${k}:\n${yaml(v, indent + 2)}` : `${pad}${k}: ${q(v)}`,
    )
    .join('\n')
}

const raw = `---
name: Molvia
description: What is worth buying, and where — for a phone in one hand, at the shelf, in bad light.
${yaml({ colors, typography, rounded: pick('radius'), spacing: pick('space-'), components })}
---
`

async function generated(file) {
  const config = (await prettier.resolveConfig(file)) ?? {}
  return prettier.format(raw, { ...config, parser: 'markdown' })
}

// The front matter of a file: from its first line to the closing `---`, both included.
function frontOf(text) {
  if (!text.startsWith('---\n')) return ''
  const end = text.indexOf('\n---\n', 3)
  return end < 0 ? '' : text.slice(0, end + 5)
}

const [mode, file] = process.argv.slice(2)

if (mode === '--write' || mode === '--check') {
  if (!file) throw new Error(`${mode} needs the path of DESIGN.md`)
  const text = readFileSync(file, 'utf8')
  const actual = frontOf(text)
  const want = await generated(file)
  if (mode === '--write') {
    if (actual !== want) writeFileSync(file, want + text.slice(actual.length).replace(/^\n?/, '\n'))
  } else if (actual !== want) {
    const have = actual.split('\n')
    const changed = want
      .split('\n')
      .flatMap((line, i) => (line === have[i] ? [] : [`- ${have[i] ?? ''}`, `+ ${line}`]))
    console.error(
      `${file}: the token block is out of date with frontend/src/styles/_tokens.scss.\n` +
        `Run \`make format\` (node bin/design-md.mjs --write ${file}). First lines that differ:\n` +
        changed.slice(0, 10).join('\n'),
    )
    process.exit(1)
  }
} else if (mode === undefined) {
  process.stdout.write(await generated('frontend/DESIGN.md'))
} else {
  throw new Error(`unknown option ${mode}`)
}
