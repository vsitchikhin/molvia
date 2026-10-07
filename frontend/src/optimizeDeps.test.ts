import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Through a parameter: a literal `new URL(…, import.meta.url)` is rewritten by Vite into an asset URL.
const at = (path: string): URL => new URL(path, import.meta.url)
const SRC = at('./')
const config = readFileSync(at('../vite.config.ts'), 'utf8')

/** `optimizeDeps.include` as `vite.config.ts` writes it. */
function included(): Set<string> {
  const list = /optimizeDeps:\s*\{[^}]*\binclude:\s*\[([^\]]*)\]/.exec(config)?.[1] ?? ''
  return new Set([...list.matchAll(/'([^']+)'/g)].map(([, name]) => name ?? ''))
}

/** Every file that starts a worker, read as the code starts one: `new Worker(new URL('./x.ts', …))`. */
function workers(): URL[] {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (file) => (file.endsWith('.ts') || file.endsWith('.vue')) && !file.endsWith('.test.ts'),
  )
  return files.flatMap((file) => {
    const url = new URL(file, SRC)
    const code = readFileSync(url, 'utf8')
    return [...code.matchAll(/new Worker\(\s*new URL\(\s*'([^']+)'/g)].map(
      ([, path]) => new URL(path ?? '', url),
    )
  })
}

/** A module of `src` by an import's path, or null when the path leaves `src`. */
function local(from: URL, path: string): URL | null {
  let url: URL
  if (path.startsWith('@/')) url = new URL(path.slice(2), SRC)
  else if (path.startsWith('.')) url = new URL(path, from)
  else return null
  for (const candidate of [url, new URL(`${url.href}.ts`)])
    if (candidate.pathname.endsWith('.ts') && existsSync(candidate)) return candidate
  throw new Error(`${path} from ${from.pathname} does not resolve`)
}

/**
 * The packages a worker loads, through every module of `src` it imports. A type is erased, an asset
 * (`?url`) is a file and not a dependency, and a package of the workspace ships its source, which the
 * dev server does not optimize.
 */
function packagesOf(entry: URL): Set<string> {
  const packages = new Set<string>()
  const seen = new Set<string>()
  const queue = [entry]
  for (let next = queue.pop(); next; next = queue.pop()) {
    if (seen.has(next.href)) continue
    seen.add(next.href)
    const code = readFileSync(next, 'utf8')
    for (const [, written, loaded] of code.matchAll(
      /^\s*(?:import|export)(?!\s+type\b)(?:[^'"]*?\bfrom\s*)?'([^']+)'|\bimport\(\s*'([^']+)'/gm,
    )) {
      const path = written ?? loaded ?? ''
      const module = local(next, path)
      if (module) queue.push(module)
      else if (!path.includes('?') && !path.startsWith('@molvia/')) packages.add(path)
    }
  }
  return packages
}

// The dev server's first crawl reads the pages, never a worker: a package only a worker imports is
// found when the worker first starts and optimized in the middle of an end-to-end run, every page
// loading then stalls — and a rating sent offline reached the server (MOL-217).
describe('optimizeDeps.include', () => {
  it('holds every package a worker imports', () => {
    const found = workers()
    expect(found.map((url) => url.pathname.split('/src/')[1])).toEqual(
      expect.arrayContaining(['scanner/barcodeWorker.ts', 'receipts/warpWorker.ts']),
    )
    const packages = new Set(found.flatMap((url) => [...packagesOf(url)]))
    // Not empty by accident: the scanner's reader is the package this rule was written for.
    expect(packages).toContain('zxing-wasm/reader')
    const missing = [...packages].filter((name) => !included().has(name))
    expect(missing, 'add them to optimizeDeps.include in vite.config.ts').toEqual([])
  })
})
