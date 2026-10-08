import { existsSync, globSync, readFileSync, readdirSync, statSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// Through a parameter: a literal `new URL(…, import.meta.url)` is rewritten by Vite into an asset URL.
const at = (path: string): URL => new URL(path, import.meta.url)
const SRC = at('./')
const ROOT = at('../')
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

const MODULE = /\.[cm]?[jt]sx?$|\.vue$/
const FILE = /\.(json|css|scss|sass|svg|png|jpe?g|gif|webp|avif|ico|wasm|woff2?|txt|html|md)$/

/** What an existing file of `src` is: a module to read, a file with nothing to follow, or neither. */
function kind(url: URL): URL | 'file' {
  if (MODULE.test(url.pathname)) return url
  if (FILE.test(url.pathname)) return 'file'
  // An extension the guard does not know is a refusal, never a file it lets through (adversarial Р3-А3).
  throw new Error(`${url.pathname}: neither a module nor a file the guard knows`)
}

/** Vite's own `resolve.extensions`, in its order: what a path without an extension may name. */
const EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json']

/**
 * What a path written in `from` names, resolved as Vite resolves it — as written, with each of its
 * extensions, a directory by its `index` with each (adversarial Р4-А3), or a `.js` written for its
 * `.ts` as TypeScript writes ESM (adversarial Р3-А4): a module of `src` to read; `'file'`, a file of
 * `src` that is no module (JSON, a stylesheet), with nothing to follow (adversarial Р2-А2); or null,
 * a path that leaves `src`.
 */
function local(from: URL, path: string): URL | 'file' | null {
  let url: URL
  if (path.startsWith('@/')) url = new URL(path.slice(2), SRC)
  else if (path.startsWith('.')) url = new URL(path, from)
  else return null
  const bare = url.href.replace(/\/$/, '')
  const candidates = [
    url,
    ...EXTENSIONS.map((extension) => new URL(`${bare}${extension}`)),
    ...EXTENSIONS.map((extension) => new URL(`${bare}/index${extension}`)),
  ]
  if (/\.[cm]?jsx?$/.test(bare)) candidates.push(new URL(bare.replace(/js(x?)$/, 'ts$1')))
  for (const candidate of candidates)
    if (existsSync(candidate) && statSync(candidate).isFile()) return kind(candidate)
  throw new Error(`${path} from ${from.pathname} does not resolve`)
}

/** Where a pattern or a `base` of `import.meta.glob` starts: `src` by `@/`, the project's root by `/`. */
function anchored(text: string, from: URL): [URL, string] {
  if (text.startsWith('@/')) return [SRC, text.slice(2)]
  if (text.startsWith('/')) return [ROOT, text.slice(1)]
  return [from, text]
}

/** A string option of an object literal, or null. */
function option(options: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const property of options.properties)
    if (ts.isPropertyAssignment(property) && property.name.getText().replace(/['"]/g, '') === name)
      return property.initializer
  return null
}

/**
 * What an `import.meta.glob` names (adversarial Р2-А1), or null for any other node: the modules of
 * `src` under its patterns — from the file, or from its `base` (adversarial Р4-А1); from `src` by
 * `@/`, from the project's root by `/` (adversarial Р3-А1) — and the query it loads them with: a
 * string, an object of flags (`{ worker: true }`) or the older `as` (adversarial Р4-А2), which makes
 * them workers when it is `worker` (adversarial Р3-А2) and assets when it is anything else. A negative
 * pattern is left out: the set read is the wider one, which can only ask for more in `include`.
 */
function globbed(node: ts.Node, from: URL): { modules: URL[]; query: string | null } | null {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isMetaProperty(node.expression.expression) ||
    node.expression.name.text !== 'glob' ||
    node.arguments[0] === undefined
  )
    return null
  const [first, given] = node.arguments
  const options = given && ts.isObjectLiteralExpression(given) ? given : null
  const written = options && option(options, 'base')
  const [baseRoot, baseRest] =
    written && ts.isStringLiteralLike(written) ? anchored(written.text, from) : [from, './']
  const base = new URL(baseRest.endsWith('/') ? baseRest : `${baseRest}/`, new URL('./', baseRoot))
  const patterns = ts.isArrayLiteralExpression(first) ? [...first.elements] : [first]
  const modules = patterns.flatMap((pattern) => {
    if (!ts.isStringLiteralLike(pattern) || pattern.text.startsWith('!')) return []
    const [root, rest] = anchored(pattern.text, base)
    const cwd = root === base ? base : new URL('./', root)
    return globSync(rest, { cwd })
      .map((file) => new URL(file, cwd))
      .filter((url) => MODULE.test(url.pathname))
  })
  let query: string | null = null
  const asked = options && option(options, 'query')
  if (asked && ts.isStringLiteralLike(asked)) query = asked.text
  else if (asked && ts.isObjectLiteralExpression(asked))
    query = `?${asked.properties.map((property) => property.name?.getText().replace(/['"]/g, '') ?? '').join('&')}`
  const as = options && option(options, 'as')
  if (query === null && as && ts.isStringLiteralLike(as)) query = `?${as.text}`
  return { modules, query }
}

const WORKER_QUERY = /^\??(shared)?worker\b/

const isImportMetaUrl = (node: ts.Node | undefined): boolean =>
  node !== undefined &&
  ts.isPropertyAccessExpression(node) &&
  ts.isMetaProperty(node.expression) &&
  node.name.text === 'url'

/**
 * Every module `src` starts as a worker, in each way Vite builds one: a module named by
 * `new URL('…', import.meta.url)` — whatever then takes the URL, a `Worker`, a `SharedWorker` or a
 * constant first — an import of `…?worker` or `…?sharedworker` (adversarial А2), and an
 * `import.meta.glob` with that `query` (adversarial Р3-А2).
 */
function workers(): URL[] {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (file) => MODULE.test(file) && !file.endsWith('.test.ts'),
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
        if (MODULE.test(url.pathname) && existsSync(url)) found.push(url)
      }
      const path = specifier(node)
      const [module, query] = path?.split('?') ?? []
      if (module && query && WORKER_QUERY.test(query)) {
        const url = local(from, module)
        if (url instanceof URL) found.push(url)
      }
      const glob = globbed(node, from)
      if (glob?.query && WORKER_QUERY.test(glob.query)) found.push(...glob.modules)
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
      const glob = globbed(node, from)
      if (glob?.query === null) queue.push(...glob.modules)
      const path = specifier(node)
      if (path === null) return
      const module = local(from, path.split('?')[0] ?? path)
      if (module instanceof URL) queue.push(module)
      else if (module === null && !path.includes('?') && !path.startsWith('@molvia/'))
        packages.add(path)
    })
  }
  return packages
}

// The dev server's first crawl reads the pages, never a worker: a package only a worker imports is
// found when the worker first starts and optimized in the middle of an end-to-end run, the pages
// loading then waiting on it (MOL-217).
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
