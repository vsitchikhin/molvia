import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickLocale } from '@molvia/model'
import { OUTDATED_MARK, belowFloor } from '@/browserFloor'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'

// Through a parameter: a literal `new URL(…, import.meta.url)` is rewritten by Vite into an asset URL.
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8')
const html = read('../index.html')
const config = read('../vite.config.ts')
const PLACEHOLDER = 'MOLVIA_OUTDATED_LINES'
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, body]) => body ?? '')
const floorScripts = scripts.filter((body) => body.includes(PLACEHOLDER))
const LINES = { ru: ru.outdated.line, en: en.outdated.line }

type Engine = 'chrome' | 'edge' | 'firefox' | 'safari' | 'ios'

/**
 * The script's markers and the versions each arrived in, from MDN's browser-compat-data
 * (`javascript.builtins.String.isWellFormed`, `javascript.builtins.Intl.Segmenter`): the floor is
 * what the newest of them says for every engine. Copied by hand, as the theme colours are; a new
 * floor brings a marker of its own here, with the line in the script.
 */
const MARKERS: readonly {
  readonly probe: string
  readonly owner: object
  readonly name: string
  readonly since: Readonly<Record<Engine, string>>
}[] = [
  {
    probe: "'isWellFormed' in String.prototype",
    owner: String.prototype,
    name: 'isWellFormed',
    since: { chrome: '111', edge: '111', firefox: '119', safari: '16.4', ios: '16.4' },
  },
  {
    probe: "typeof Intl.Segmenter === 'function'",
    owner: Intl,
    name: 'Segmenter',
    since: { chrome: '87', edge: '87', firefox: '125', safari: '14.1', ios: '14.5' },
  },
]

/** `build.target` as `vite.config.ts` writes it, by engine. */
function floor(): Map<string, string> {
  // Whatever Prettier makes of the object, and wherever the key stands in it (self-review №4).
  expect(config, 'build.target is BROWSER_FLOOR').toMatch(
    /build:\s*\{[^}]*\btarget:\s*BROWSER_FLOOR\b/,
  )
  const list = /const BROWSER_FLOOR = \[([^\]]*)\]/.exec(config)?.[1] ?? ''
  const entries = [...list.matchAll(/'([a-z]+)([\d.]+)'/g)].map(
    ([, engine, version]) => [engine ?? '', version ?? ''] as const,
  )
  return new Map(entries)
}

function compare(a: string, b: string): number {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const step = (x[i] ?? 0) - (y[i] ?? 0)
    if (step !== 0) return step
  }
  return 0
}

/** The script as the browser runs it, its lines put in as the build puts them. */
function runFloorScript(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own script, as the browser runs it
  new Function(PLACEHOLDER, floorScripts[0] ?? '')(LINES)
}

/** Takes a marker away for one test, as a browser below the floor lacks it. */
const restored: (() => void)[] = []
function without(owner: object, name: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name)
  if (descriptor === undefined) throw new Error(`${name} is not there to take away`)
  Reflect.deleteProperty(owner, name)
  restored.push(() => {
    Object.defineProperty(owner, name, descriptor)
  })
}

beforeEach(() => {
  document.documentElement.removeAttribute(OUTDATED_MARK)
  document.documentElement.lang = 'ru'
  document.body.innerHTML = '<div id="app"></div>'
})

afterEach(() => {
  for (const restore of restored.splice(0)) restore()
  vi.restoreAllMocks()
})

const app = (): string => document.getElementById('app')?.textContent ?? ''

describe('пол сборки (MOL-231)', () => {
  it('один скрипт, после #app и до модуля приложения', () => {
    expect(floorScripts).toHaveLength(1)
    const at = html.indexOf(floorScripts[0] ?? '')
    expect(html.indexOf('<div id="app"></div>')).toBeLessThan(at)
    expect(html.indexOf('<script type="module"')).toBeGreaterThan(at)
  })

  it('маркеры указывают ровно на build.target: по каждому движку новейший из них — пол', () => {
    const target = floor()
    expect([...target.keys()].sort()).toEqual(['chrome', 'edge', 'firefox', 'ios', 'safari'])
    for (const [engine, version] of target) {
      const newest = MARKERS.map((marker) => marker.since[engine as Engine]).reduce((a, b) =>
        compare(a, b) >= 0 ? a : b,
      )
      expect([engine, newest]).toEqual([engine, version])
    }
  })

  it('условие скрипта — ровно маркеры таблицы, ни пробы сверх них', () => {
    // A probe added to the script and not to the table would raise the floor above build.target
    // unseen (self-review №1, adversarial А2, M1): the condition is read whole.
    const condition = /if \((.+)\) return/.exec(floorScripts[0] ?? '')?.[1]
    expect(condition).toBe(MARKERS.map((marker) => marker.probe).join(' && '))
  })

  it('заглушка строки названа в index.html один раз — в самом скрипте', () => {
    expect(html.split(PLACEHOLDER)).toHaveLength(2)
    expect(floorScripts[0]).toContain(`var lines = ${PLACEHOLDER}`)
  })

  it('браузер не ниже пола проходит незаметно: ни отметки, ни строки, язык прежний', () => {
    runFloorScript()
    expect(belowFloor()).toBe(false)
    expect(app()).toBe('')
    expect(document.documentElement.lang).toBe('ru')
  })

  it.each(MARKERS.map((marker) => [marker.name, marker] as const))(
    'без %s — отметка и одна строка на месте приложения',
    (_name, marker) => {
      vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['ru-RU'])
      without(marker.owner, marker.name)
      runFloorScript()
      expect(belowFloor()).toBe(true)
      expect(app()).toBe(ru.outdated.line)
    },
  )

  it.each([
    [['en-US', 'ru'], 'en'],
    [['en'], 'en'],
    [['EN_gb'], 'en'],
    [['enm'], 'ru'],
    [['ru-RU', 'en'], 'ru'],
    [['hy-AM'], 'ru'],
    [['de'], 'ru'],
    [[], 'ru'],
  ] as const)('язык %j — правилом pickLocale, и lang с ним', (languages, expected) => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(languages)
    without(String.prototype, 'isWellFormed')
    runFloorScript()
    expect(pickLocale(languages)).toBe(expected)
    expect(document.documentElement.lang).toBe(expected)
    expect(app()).toBe(LINES[expected])
  })
})
