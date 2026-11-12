// Types of release.mjs for its test: the script is plain JS, which the workflows run as is.
export declare const NAMES: readonly (readonly string[])[]
export declare const NIGHT_MARK: string
export interface Release {
  readonly n: number
  readonly name: string
  readonly tag: string
  readonly branch: string
}
export declare function releaseName(n: number): string
export declare function parseTag(
  tag: string,
): { readonly n: number; readonly name: string | null; readonly hotfix: number | null } | null
export declare function lastRelease(tags: readonly string[]): number
export declare function release(n: number): Release
export declare function nextRelease(tags: readonly string[]): Release
export declare function mergedBranch(subject: string): string | null
export declare function releaseDue(input: {
  readonly event: string
  readonly differs: boolean
  readonly merges: readonly { readonly at: Date; readonly subject: string }[]
  readonly now: Date
}): { readonly due: boolean; readonly reason: string }
export type AfterMerge =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'release'
      readonly tag: string
      readonly next: string
      readonly stale: readonly string[]
    }
  | { readonly kind: 'hotfix'; readonly tag: string; readonly next: string }
export declare function afterMerge(branch: string | null, tags: readonly string[]): AfterMerge
export declare function sourceAllowed(base: string, head: string): boolean
