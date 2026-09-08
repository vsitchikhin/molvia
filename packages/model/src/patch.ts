import { ISSUE } from './errors'

/** Values, not keys: an explicit undefined is a key, and `{ score: form.score }` is common. */
export function changesSomething(patch: Record<string, unknown>): boolean {
  return Object.values(patch).some((value) => value !== undefined)
}

export const PATCH_EMPTY = { error: ISSUE.PATCH_EMPTY } as const
