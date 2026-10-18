// Types of check-clock-bounds.mjs for its test: the check is plain JS, which `npm run lint` runs as is.
export declare function rawBounds(
  fileName: string,
  source: string,
  options?: { setupTouchesTimers?: boolean },
): string[]
export declare function unsureDirectories(
  configs: { path: string; text: string }[],
  read: (path: string) => string | undefined,
): string[]
export declare function vitestFlagsUnsure(texts: string[], configs?: string[]): boolean
