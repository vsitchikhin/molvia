import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The status bar and the splash screen are painted from index.html and the manifest, which
 * cannot read a custom property. The colours are copied there — and this is what keeps the
 * copies honest: change a token and the old value fails here instead of leaving a dark strip
 * over a light header.
 */
function read(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const tokens = read('./_tokens.scss')
const light = tokens.slice(tokens.indexOf(':root {'), tokens.indexOf('@mixin dark-scheme'))
const dark = tokens.slice(tokens.indexOf('@mixin dark-scheme'))

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)
  if (!match?.[1]) throw new Error(`--${name} not found`)
  return match[1]
}

describe('colours outside the tokens', () => {
  const html = read('../../index.html')
  const config = read('../../vite.config.ts')

  it.each([
    ['light', light],
    ['dark', dark],
  ])('the %s status bar is --surface of that scheme', (scheme, block) => {
    const meta = new RegExp(
      `<meta name="theme-color" media="\\(prefers-color-scheme: ${scheme}\\)" content="(#[0-9a-f]{6})"`,
    ).exec(html)
    expect(meta?.[1]).toBe(token(block, 'surface'))
  })

  it('declares no theme colour that ignores the scheme', () => {
    expect(html).not.toMatch(/<meta name="theme-color" content=/)
  })

  it('the manifest carries the light --surface and --sunken', () => {
    expect(config).toContain(`theme_color: '${token(light, 'surface')}'`)
    expect(config).toContain(`background_color: '${token(light, 'sunken')}'`)
  })
})
