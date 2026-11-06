// Types of check-pins.mjs for its test: the check is plain JS, which `npm run lint` runs as is.
export declare function workflowProblems(path: string, text: string): string[]
export declare function dockerfileProblems(path: string, text: string): string[]
export declare function dependabotProblems(dockerfiles: string[], text: string): string[]
export declare function pinProblems(files: { path: string; text: string }[]): string[]
export declare function checkedPaths(paths: string[]): string[]
export declare function repositoryProblems(): string[]
