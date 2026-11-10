// Types of npm-audit.mjs for its test: the check is plain JS, which CI runs as is.
export interface Advisory {
  id: string
  name: string
  title: string
  severity: string
}
export declare function seriousAdvisories(report: unknown): Advisory[] | null
export declare function auditVerdict(
  report: unknown,
  accepted: unknown,
  today: string,
): { problems: string[]; notes: string[] }
