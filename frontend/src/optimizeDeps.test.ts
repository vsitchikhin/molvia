import { existsSync, readFileSync, readdirSync } from 'node:fs'
import ts from 'typescript'
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

/** A file's code as the compiler reads it: a component's `<script>` alone. */
function parse(url: URL): ts.SourceFile {
  const code = readFileSync(url, 'utf8')
  const script = url.pathname.endsWith('.vue')
    ? [...code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(([, body]) => body).join('\n')
    : code
  return ts.createSourceFile(url.pathname, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => {
    walk(child, visit)
  })
}

/** A module of `src` by a path written in `from`, or null when the path leaves `src`. */
function local(from: URL, path: string): URL | null {
  let url: URL
  if (path.startsWith('@/')) url = new URL(path.slice(2), SRC)
  else if (path.startsWith('.')) url = new URL(path, from)
  else return null
  for (const candidate of [url, new URL(`${url.href}.ts`)])
    if (/\.(ts|vue)$/.test(candidate.pathname) && existsSync(candidate)) return candidate
  throw new Error(`${path} from ${from.pathname} does not resolve`)
}

const isImportMetaUrl = (node: ts.Node | undefined): boolean =>
  node !== undefined &&
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.name.text === 'url'

/**
 * Every module `src` starts as a worker, in each way Vite builds one: a module named by
 * `new URL('…', import.meta.url)` — whatever then takes the URL, a `Worker`, a `SharedWorker` or a
 * constant first — and an import of `…?worker` or `…?sharedworker` (adversarial А2).
 */
function workers(): URL[] {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (file) => /\.(ts|vue)$/.test(file) && !file.endsWith('.test.ts'),
  )
  return files.flatMap((file) => {
    const from = new URL(file, SRC)
    const found: URL[] = []
    walk(parse(from), (node) => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        node.arguments?.[0] !== undefined &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        isImportMetaUrl(node.arguments[1])
      ) {
        const url = new URL(node.arguments[0].text, from)
        if (/\.(ts|js)$/.test(url.pathname) && existsSync(url)) found.push(url)
      }
      const path = specifier(node)
      const [module, query] = path?.split('?') ?? []
      if (module && query && /^(shared)?worker\b/.test(query)) {
        const url = local(from, module)
        if (url) found.push(url)
      }
    })
    return found
  })
}

/**
 * What a node loads at run time: an import or an export from a module, a bare `import 'x'` or an
 * `import('x')` (adversarial А1). A type is erased and loads nothing.
 */
function specifier(node: ts.Node): string | null {
  if (
    ts.isImportDeclaration(node) &&
    node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
  )
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
  if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier)
    return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0] !== undefined &&
    ts.isStringLiteralLike(node.arguments[0])
  )
    return node.arguments[0].text
  return null
}

/**
 * The packages a worker loads, through every module of `src` it imports. An asset (`?url`) is a
 * file and not a dependency. A package of the workspace (`@molvia/*`) ships its source, which the
 * dev server does not optimize, and its own imports are not followed — the price: a package a worker
 * reached only through one would pass unseen; today no worker imports one (self-review С-4).
 */
function packagesOf(entry: URL): Set<string> {
  const packages = new Set<string>()
  const seen = new Set<string>()
  const queue = [entry]
  for (let next = queue.pop(); next; next = queue.pop()) {
    if (seen.has(next.href)) continue
    seen.add(next.href)
    const from = next
    walk(parse(from), (node) => {
      const path = specifier(node)
      if (path === null) return
      const module = local(from, path.split('?')[0] ?? path)
      if (module) queue.push(module)
      else if (!path.includes('?') && !path.startsWith('@molvia/')) packages.add(path)
    })
  }
  return packages
}

// The dev server's first crawl reads the pages, never a worker: a package only a worker imports is
// found when the worker first starts and optimized in the middle of an end-to-end run. That stood
// seconds before each of the four failures of `verdicts.spec` (MOL-217).
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
