import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import { Tokenizer } from '@huggingface/tokenizers'
import type { InferenceSession, Tensor } from 'onnxruntime-node'
import { describeFailure } from '@/db/failure'
import spec from './model.json'

/**
 * What the vectors of the catalogue are made by (MOL-105): the model and the revision its files
 * were pinned at. Stored beside every vector — a vector of another model is noise to this one,
 * so a change of either makes the writer compute them all again and the search read none of the
 * old ones.
 */
export const EMBEDDING_MODEL = `${spec.name}@${spec.revision.slice(0, 7)}`
export const EMBEDDING_DIMENSIONS = spec.dimensions

/**
 * Two of the machine's four cores (MOL-105, measured on the VPS): one query in 45 ms at the
 * median, 70 at p95 — three threads win six more and leave Postgres and the receipts' reader
 * (MOL-125) one core between them.
 */
const THREADS = 2

/**
 * How long a search waits for its vector before answering by the letters alone. Twice the p95
 * of the VPS: a query that misses it is still computed, and kept, so the next keystroke of the
 * same word finds it ready.
 */
const QUERY_WAIT_MS = 150

/** Queries remembered with their vectors: typing a word letter by letter asks each cut again. */
const QUERY_CACHE = 1000

/**
 * EmbeddingGemma's own prompts for retrieval: a query and a document are asked differently, and
 * measured on the seed the prompts for similarity gave the same, those for clustering worse.
 */
const queryText = (query: string): string => `task: search result | query: ${query}`
const nameText = (name: string): string => `title: none | text: ${name}`

/**
 * A query as it is put to the model and kept in the cache: one spelling of the same text. Lower
 * case, as the words of the shelf were measured; at most a hundred characters — the meaning of a
 * shelf word is in its first words, and the time grows with every token.
 */
export function meaningText(query: string): string {
  return query.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase().slice(0, 100)
}

export interface EmbeddingLog {
  info(details: object, message: string): void
  warn(details: object, message: string): void
}

/**
 * The model of catalogue search, resident in the API (MOL-105, В-1). It is an addition and never
 * a condition: while it loads, if its files are missing, if it fails, `ready` is false, a query
 * gets `null` and the search answers by the letters alone.
 */
export interface Embedder {
  readonly model: string
  ready(): boolean
  /** Settles once the model is loaded; never, if it is not — the writer starts on it. */
  readonly loaded: Promise<void>
  /** The vector of a query, or `null` — not ready, failed, or slower than `QUERY_WAIT_MS`. */
  query(text: string): Promise<readonly number[] | null>
  /** The vector of a catalogue name; refuses when not ready. Waits behind every query. */
  name(text: string): Promise<readonly number[]>
}

/** The embedder that never has a vector: a copy without the model, end-to-end, most tests. */
export const NO_EMBEDDER: Embedder = {
  model: EMBEDDING_MODEL,
  ready: () => false,
  loaded: new Promise(() => undefined),
  query: () => Promise.resolve(null),
  name: () => Promise.reject(new Error('no embedding model')),
}

interface Loaded {
  readonly tokenizer: Tokenizer
  readonly session: InferenceSession
  readonly tensor: typeof Tensor
}

/**
 * Starts loading the model from `dir` and answers at once; until it is loaded it has no vectors.
 * One run of the model at a time, queries ahead of names: the writer filling a fresh catalogue
 * must not keep a search waiting for more than one name.
 */
export function startEmbedder(dir: string, log: EmbeddingLog): Embedder {
  let current: Loaded | null = null
  const cache = new Map<string, readonly number[]>()
  const urgent: (() => Promise<void>)[] = []
  const rest: (() => Promise<void>)[] = []
  let busy = false

  function next(): void {
    if (busy) return
    const job = urgent.shift() ?? rest.shift()
    if (!job) return
    busy = true
    void job().finally(() => {
      busy = false
      next()
    })
  }

  function run(text: string, first: boolean): Promise<readonly number[]> {
    return new Promise((resolve, reject) => {
      ;(first ? urgent : rest).push(async () => {
        try {
          if (!current) throw new Error('no embedding model')
          resolve(await embed(current, text))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      next()
    })
  }

  const ready = load(dir).then(
    (model) => {
      current = model
      if (model) log.info({ model: EMBEDDING_MODEL }, 'embedding model loaded')
      else log.warn({ model: EMBEDDING_MODEL }, 'embedding model not found, search by letters only')
      return model !== null
    },
    (error: unknown) => {
      log.warn(describeFailure(error), 'embedding model failed to load, search by letters only')
      return false
    },
  )

  return {
    model: EMBEDDING_MODEL,
    ready: () => current !== null,
    loaded: ready.then((done) => (done ? undefined : new Promise<void>(() => undefined))),
    async query(text) {
      const key = meaningText(text)
      const kept = cache.get(key)
      if (kept) return kept
      if (!current || key === '') return null
      const vector = run(queryText(key), true).then(
        (found) => {
          if (cache.size >= QUERY_CACHE) cache.delete(cache.keys().next().value ?? '')
          cache.set(key, found)
          return found
        },
        (error: unknown) => {
          log.warn(describeFailure(error), 'embedding a query failed')
          return null
        },
      )
      let timer: NodeJS.Timeout | undefined
      const late = new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null)
        }, QUERY_WAIT_MS)
      })
      try {
        return await Promise.race([vector, late])
      } finally {
        clearTimeout(timer)
      }
    },
    name: (text) => run(nameText(text), false),
  }
}

async function load(dir: string): Promise<Loaded | null> {
  const files = Object.keys(spec.files).map((file) => join(dir, file))
  if (!files.every((file) => existsSync(file))) return null
  // onnxruntime-node carries Microsoft's telemetry since 1.30 — an id of the device and an upload
  // over HTTPS, started with the first session. No third party sees anything of ours (privacy.md):
  // switched off here, before the library is loaded, and in the image's environment as well.
  process.env.ORT_DISABLE_TELEMETRY = '1'
  const ort = await import('onnxruntime-node')
  const [tokenizerJson, tokenizerConfig] = await Promise.all([
    readFile(join(dir, 'tokenizer.json'), 'utf8'),
    readFile(join(dir, 'tokenizer_config.json'), 'utf8'),
  ])
  const tokenizer = new Tokenizer(
    JSON.parse(tokenizerJson) as object,
    JSON.parse(tokenizerConfig) as object,
  )
  const session = await ort.InferenceSession.create(join(dir, 'onnx/model_q4.onnx'), {
    intraOpNumThreads: THREADS,
    interOpNumThreads: 1,
    executionMode: 'sequential',
    graphOptimizationLevel: 'all',
  })
  return { tokenizer, session, tensor: ort.Tensor }
}

async function embed({ tokenizer, session, tensor }: Loaded, text: string): Promise<number[]> {
  const ids = tokenizer.encode(text).ids
  const shape = [1, ids.length]
  const output = await session.run(
    {
      input_ids: new tensor(
        'int64',
        BigInt64Array.from(ids, (id) => BigInt(id)),
        shape,
      ),
      attention_mask: new tensor('int64', new BigInt64Array(ids.length).fill(1n), shape),
    },
    ['sentence_embedding'],
  )
  const values = Array.from(output.sentence_embedding?.data as Float32Array)
  const norm = Math.hypot(...values)
  return values.map((value) => value / norm)
}
