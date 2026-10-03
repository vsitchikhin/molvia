/**
 * The photos of receipts on this phone (MOL-127, Т-3, Т-4): the bytes of every part, kept in
 * IndexedDB — a part is half a megabyte to a megabyte and a half, which no Web Storage shelf holds.
 *
 * **A database per owner** (`molvia.receipt-photos.<owner>`), so «Выйти» and erasure take it whole by
 * its name (`forgetPhotos`) and the next person on this phone never opens it. The queue's writes stay
 * in Web Storage with every other queue; only the bytes are here, written before the write that names
 * them, so a write never points at photos that were not kept.
 *
 * **Kept until the receipt is recorded, removed or gone from the server** — not until it is sent:
 * the server gives no photo back, and «не разобран» shows the parts from this phone. `keepOnly`
 * lets go of what nothing names any more, sparing what was put in the last minutes: a list read set
 * out before an upload landed does not name that receipt yet.
 *
 * Opened for each call and closed after it, so a deletion of the database from another window is
 * never held up by this one; `versionchange` closes a connection that is open at that moment.
 * Every call settles: a phone that refuses IndexedDB — a private window of an old Safari — keeps
 * nothing, and the queue says «не принят» for a photo it cannot find rather than hang.
 */

const STORE = 'parts'
/** A photo younger than this is never let go by `keepOnly`: its receipt may not be in a list yet. */
export const PHOTO_SPARED_MS = 10 * 60 * 1000

export interface PhotoShelf {
  /** Whether the photo was kept: false — nothing to keep it in, and the part must not be queued. */
  put(receiptId: string, part: number, photo: Blob): Promise<boolean>
  get(receiptId: string, part: number): Promise<Blob | null>
  /** Every part of a receipt, by its number. */
  parts(receiptId: string): Promise<Blob[]>
  drop(receiptId: string): Promise<void>
  /** Lets go of the photos of every receipt not named, except those put in the last minutes. */
  keepOnly(receiptIds: ReadonlySet<string>): Promise<void>
}

interface Kept {
  readonly receiptId: string
  readonly part: number
  readonly photo: Blob
  readonly at: number
}

export function photosName(owner: string): string {
  return `molvia.receipt-photos.${owner}`
}

function partKey(receiptId: string, part: number): string {
  return `${receiptId}/${String(part)}`
}

function request<T>(asked: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    asked.onsuccess = () => {
      resolve(asked.result)
    }
    asked.onerror = () => {
      reject(asked.error ?? new Error('indexeddb'))
    }
  })
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve()
    }
    transaction.onerror = () => {
      reject(transaction.error ?? new Error('indexeddb'))
    }
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('indexeddb'))
    }
  })
}

function open(owner: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // The property itself throws where storage is blocked outright, as `localStorage` does.
    const opening = indexedDB.open(photosName(owner), 1)
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(STORE)
    }
    opening.onsuccess = () => {
      const database = opening.result
      database.onversionchange = () => {
        database.close()
      }
      resolve(database)
    }
    opening.onerror = () => {
      reject(opening.error ?? new Error('indexeddb'))
    }
    opening.onblocked = () => {
      reject(new Error('indexeddb blocked'))
    }
  })
}

async function using<T>(
  owner: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await open(owner)
  try {
    const transaction = database.transaction(STORE, mode)
    const result = await work(transaction.objectStore(STORE))
    await done(transaction)
    return result
  } finally {
    database.close()
  }
}

/** Every key of one receipt's parts: `<id>/1` … `<id>/9`, and nothing of another receipt. */
function receiptRange(receiptId: string): IDBKeyRange {
  return IDBKeyRange.bound(`${receiptId}/`, `${receiptId}/￿`)
}

function isKept(value: unknown): value is Kept {
  if (typeof value !== 'object' || value === null) return false
  const { receiptId, part, photo, at } = value as Record<string, unknown>
  return (
    typeof receiptId === 'string' &&
    typeof part === 'number' &&
    photo instanceof Blob &&
    typeof at === 'number'
  )
}

export function photoShelf(owner: string): PhotoShelf {
  return {
    async put(receiptId, part, photo) {
      const kept: Kept = { receiptId, part, photo, at: Date.now() }
      try {
        await using(owner, 'readwrite', (store) =>
          request(store.put(kept, partKey(receiptId, part))),
        )
        return true
      } catch {
        return false
      }
    },

    async get(receiptId, part) {
      try {
        const value = await using(owner, 'readonly', (store) =>
          request<unknown>(store.get(partKey(receiptId, part))),
        )
        return isKept(value) ? value.photo : null
      } catch {
        return null
      }
    },

    async parts(receiptId) {
      try {
        const values = await using(owner, 'readonly', (store) =>
          request<unknown[]>(store.getAll(receiptRange(receiptId))),
        )
        return values
          .filter(isKept)
          .sort((a, b) => a.part - b.part)
          .map((value) => value.photo)
      } catch {
        return []
      }
    },

    async drop(receiptId) {
      try {
        await using(owner, 'readwrite', (store) => request(store.delete(receiptRange(receiptId))))
      } catch {
        // Nothing kept, or nothing to keep it in: there is nothing to let go of either.
      }
    },

    async keepOnly(receiptIds) {
      const spared = Date.now() - PHOTO_SPARED_MS
      try {
        await using(owner, 'readwrite', async (store) => {
          const values = await request<unknown[]>(store.getAll())
          for (const value of values) {
            if (!isKept(value) || receiptIds.has(value.receiptId) || value.at > spared) continue
            store.delete(partKey(value.receiptId, value.part))
          }
        })
      } catch {
        // Tried again with the next list.
      }
    },
  }
}

/**
 * Takes the owner's photos off the phone — «Выйти», erasure, a drawer erased in another window
 * (MOL-57). Settles once the browser has deleted the database or refused to: the page reload that
 * follows «Выйти» must not cut the deletion short.
 */
export function forgetPhotos(owner: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const deleting = indexedDB.deleteDatabase(photosName(owner))
      deleting.onsuccess = () => {
        resolve()
      }
      deleting.onerror = () => {
        resolve()
      }
      // Another window holds it open for a moment: its `versionchange` closes it, and the
      // deletion goes on by itself.
      deleting.onblocked = () => {
        resolve()
      }
    } catch {
      resolve()
    }
  })
}
