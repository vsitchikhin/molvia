// Types of check-ordered-reads.mjs for its test: the check is plain JS, which `npm run lint` runs as is.
export declare function unorderedReads(
  fileName: string,
  source: string,
  chance?: Set<string>,
  identity?: Set<string>,
  keys?: string[][],
  known?: Set<string>,
): string[]
export declare function chanceColumns(source: string): Set<string>
export declare function identityColumns(source: string): Set<string>
export declare function uniqueKeys(source: string): string[][]
export declare function schemaTables(source: string): Set<string>
