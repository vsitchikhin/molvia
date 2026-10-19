// Types of check-clock-bounds.mjs for its test: the check is plain JS, which `npm run lint` runs as is.
export declare function rawBounds(fileName: string, source: string): string[]
export declare function boundsOf(
  fileName: string,
  source: string,
): { found: string[]; noted: string[] }
