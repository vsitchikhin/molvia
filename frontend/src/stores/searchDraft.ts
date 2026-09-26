/**
 * What is typed on «Что взяли?» — the query, and the query that found nothing the person's own
 * word learns from (MOL-45) — kept across a reload of this window, and no longer (MOL-46).
 *
 * A new version of the app reloads the page once it is put away (`pwaUpdate.ts`), and at the shelf
 * it is put away mid-search to ask what a thing is called here. Held against the update instead,
 * a typed query kept out the very version that fixes a search the old code could no longer read
 * (adversarial review Ж2), and a field erased with the miss still in memory let it through (Ж1).
 *
 * This window's shelf only: another window opening the search must not come up with this one's
 * query. Put away with the screen — leaving it forgets the query as it always did — which a reload
 * never does, since the page is torn down without unmounting anything.
 */

export interface SearchDraft {
  readonly query: string
  readonly missed: string | null
}

const keyOf = (owner: string): string => `molvia.search-draft.${owner}`

function shelf(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function recallSearchDraft(owner: string | null): SearchDraft | null {
  if (owner === null) return null
  try {
    const value: unknown = JSON.parse(shelf()?.getItem(keyOf(owner)) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const { query, missed } = value as { query?: unknown; missed?: unknown }
    if (typeof query !== 'string') return null
    return { query, missed: typeof missed === 'string' ? missed : null }
  } catch {
    return null
  }
}

export function keepSearchDraft(owner: string | null, draft: SearchDraft): void {
  if (owner === null) return
  try {
    if (draft.query === '' && draft.missed === null) shelf()?.removeItem(keyOf(owner))
    else shelf()?.setItem(keyOf(owner), JSON.stringify(draft))
  } catch {
    // A shelf that refuses leaves the search as it was before: in memory only.
  }
}

export function dropSearchDraft(owner: string | null): void {
  if (owner === null) return
  try {
    shelf()?.removeItem(keyOf(owner))
  } catch {
    // Nothing to put away.
  }
}
