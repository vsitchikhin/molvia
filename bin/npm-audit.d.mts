// Types of npm-audit.mjs for its test: the check is plain JS, which CI runs as is.
export interface Advisory {
  id: string
  name: string
  title: string
  severity: string
}
/** The lockfile's packages by their path, as `package-lock.json` holds them. */
export interface Lock {
  packages: Record<string, { dev?: boolean }>
}
export declare function seriousAdvisories(report: unknown, lock?: Lock): Advisory[] | null
export declare function auditVerdict(
  report: unknown,
  accepted: unknown,
  today: string,
  lock?: Lock,
): { problems: string[]; notes: string[] }
