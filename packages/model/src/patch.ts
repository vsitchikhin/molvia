import { ISSUE } from './errors'

/**
 * A patch has to change something.
 *
 * `Object.keys(patch).length > 0` counted a key whose value is an explicit `undefined`,
 * so `{ score: form.score }` built from an unfilled form passed the check and bumped
 * `updatedAt` — precisely what the check exists to prevent, since any history built on
 * that column then shows a change that never happened. Unreachable from JSON, ordinary
 * from a TypeScript client, which the bot and the PWA both are.
 */
export function changesSomething(patch: Record<string, unknown>): boolean {
  return Object.values(patch).some((value) => value !== undefined)
}

export const PATCH_EMPTY = { error: ISSUE.PATCH_EMPTY } as const
