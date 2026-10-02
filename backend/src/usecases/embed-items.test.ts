import { describe, expect, it } from 'vitest'
import type { ItemEmbedding, ItemEmbeddingRepository } from '@/db/item-embeddings-repository'
import { EMBED_BATCH, embedMissing, startItemEmbedding } from './embed-items'

function catalogue(names: readonly string[]) {
  const vectors = new Map<string, ItemEmbedding & { model: string }>()
  const items = names.map((name, index) => ({ id: `item-${String(index)}`, name }))
  const asked: number[] = []
  const embeddings: ItemEmbeddingRepository = {
    missing: (model, limit) => {
      asked.push(limit)
      return Promise.resolve(
        items.filter((item) => vectors.get(item.id)?.model !== model).slice(0, limit),
      )
    },
    write: (model, rows) => {
      for (const row of rows) vectors.set(row.itemId, { ...row, model })
      return Promise.resolve()
    },
  }
  return { embeddings, vectors, asked }
}

const ready = (model = 'model@1') => ({
  model,
  ready: () => true,
  name: (text: string) => Promise.resolve([text.length, 1]),
})

describe('embedMissing', () => {
  it('writes a vector of the current model for every item without one, batch by batch', async () => {
    const names = Array.from({ length: EMBED_BATCH + 3 }, (_, index) => `Имя ${String(index)}`)
    const world = catalogue(names)

    expect(await embedMissing({ embeddings: world.embeddings, embedder: ready() })).toBe(
      EMBED_BATCH + 3,
    )
    expect(world.vectors.size).toBe(EMBED_BATCH + 3)
    expect(world.vectors.get('item-0')).toEqual({
      itemId: 'item-0',
      model: 'model@1',
      embedding: ['Имя 0'.length, 1],
    })
    // Two batches and the read that found nothing left.
    expect(world.asked).toEqual([EMBED_BATCH, EMBED_BATCH, EMBED_BATCH])
  })

  it('writes again what another model made: its vector is noise to this one', async () => {
    const world = catalogue(['Кефир'])
    await embedMissing({ embeddings: world.embeddings, embedder: ready('old@1') })
    await embedMissing({ embeddings: world.embeddings, embedder: ready('new@2') })
    expect(world.vectors.get('item-0')?.model).toBe('new@2')
  })

  it('without a model reads nothing and writes nothing', async () => {
    const world = catalogue(['Кефир'])
    const embedder = { ...ready(), ready: () => false }
    expect(await embedMissing({ embeddings: world.embeddings, embedder })).toBe(0)
    expect(world.asked).toEqual([])
  })
})

describe('startItemEmbedding', () => {
  it('runs at once, and a nudge during a run runs it once more after — never twice at a time', async () => {
    let runs = 0
    let open = 0
    let most = 0
    let release: (() => void) | undefined
    const write = async () => {
      runs += 1
      open += 1
      most = Math.max(most, open)
      await new Promise<void>((resolve) => {
        release = resolve
      })
      open -= 1
    }
    const writer = startItemEmbedding(write, () => undefined)
    writer.nudge()
    writer.nudge()
    expect(runs).toBe(1)
    release?.()
    await new Promise((resolve) => setImmediate(resolve))
    expect(runs).toBe(2)
    release?.()
    await writer.stop()
    expect(runs).toBe(2)
    expect(most).toBe(1)
  })

  it('reports a failed run and keeps going', async () => {
    const failures: unknown[] = []
    let runs = 0
    const writer = startItemEmbedding(
      () => {
        runs += 1
        return Promise.reject(new Error('model gone'))
      },
      (error) => failures.push(error),
    )
    await new Promise((resolve) => setImmediate(resolve))
    writer.nudge()
    await writer.stop()
    expect(runs).toBe(2)
    expect(failures).toHaveLength(2)
  })
})
