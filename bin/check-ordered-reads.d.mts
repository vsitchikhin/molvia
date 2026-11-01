// Types of check-ordered-reads.mjs for its test: the check is plain JS, which `npm run lint` runs as is.
export declare function unorderedReads(
  fileName: string,
  source: string,
  uuids?: Set<string>,
): string[]
export declare function uuidColumns(source: string): Set<string>
export declare const MAY_READ: RegExp
