// Types of scan-images.mjs for its test: the script is plain JS, which `scan.yml` runs as is.
export interface Finding {
  image: string
  ours: boolean
  id: string
  severity: string
  what: string
  where: string
}
export declare const IMAGES: string[]
export declare function findingsOf(image: string, report: unknown): Finding[]
export declare function summaryOf(
  tag: string,
  findings: Finding[],
  unscanned: { image: string; reason: string }[],
): string
