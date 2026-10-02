import type { ItemEmbeddingRepository } from '@/db/item-embeddings-repository'
import type { Embedder } from '@/embeddings/embedder'

/** Names read per round: a write per batch, and the newest proposal waits behind at most this. */
export const EMBED_BATCH = 64

export interface EmbedItemsDeps {
  readonly embeddings: ItemEmbeddingRepository
  readonly embedder: Pick<Embedder, 'model' | 'ready' | 'name'>
}

/**
 * The one writer of `item_embeddings` (MOL-105): every item without a vector of the current model
 * gets one — a proposal, the seed, the whole catalogue after a change of model. Nothing else
 * writes a vector, and no write of an item waits for one: «Предложить товар» answers before the
 * model has seen the name, which the search finds by its letters meanwhile.
 *
 * Returns how many were written. Without a model, none.
 */
export async function embedMissing({ embeddings, embedder }: EmbedItemsDeps): Promise<number> {
  let written = 0
  while (embedder.ready()) {
    const batch = await embeddings.missing(embedder.model, EMBED_BATCH)
    if (batch.length === 0) break
    const rows = []
    for (const item of batch) {
      rows.push({ itemId: item.id, embedding: await embedder.name(item.name) })
    }
    await embeddings.write(embedder.model, rows)
    written += rows.length
  }
  return written
}

/**
 * Runs the writer once a minute and whenever `nudge` asks — after a proposal, once the model has
 * loaded. A nudge during a run is not lost: the run is repeated once it ends, so the item proposed
 * meanwhile is not left for the next minute. Unreferenced, as every timer of the API.
 */
export function startItemEmbedding(
  write: () => Promise<unknown>,
  failed: (error: unknown) => void,
): { nudge(): void; stop(): Promise<void> } {
  let running: Promise<void> | undefined
  let again = false
  const tick = (): void => {
    if (running) {
      again = true
      return
    }
    again = false
    running = write()
      .then(() => undefined, failed)
      .finally(() => {
        running = undefined
        if (again) tick()
      })
  }
  tick()
  const timer = setInterval(tick, 60_000)
  timer.unref()
  return {
    nudge: tick,
    async stop() {
      clearInterval(timer)
      again = false
      await running
    },
  }
}
