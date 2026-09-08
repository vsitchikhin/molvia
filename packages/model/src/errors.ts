/**
 * Domain errors come from this registry, never from strings written in place.
 * The codes double as i18n keys, so a message is never hardcoded on the way to a user.
 */
export const ERROR = {
  INVALID_AMOUNT: 'error.invalid_amount',
  INVALID_QUANTITY: 'error.invalid_quantity',
  INVALID_RATE: 'error.invalid_rate',
  INVALID_SCORE: 'error.invalid_score',
  CURRENCY_MISMATCH: 'error.currency_mismatch',
  UNIT_MISMATCH: 'error.unit_mismatch',
  NOT_FOUND: 'error.not_found',
  INTERNAL: 'error.internal',
} as const

export type ErrorCode = (typeof ERROR)[keyof typeof ERROR]

export class DomainError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, details?: string) {
    super(details ? `${code}: ${details}` : code)
    this.name = 'DomainError'
    this.code = code
  }
}

/**
 * Keys for zod issues. An issue is a shape error, not a domain one — it never becomes a
 * DomainError, and the central handler turns it into a 400 — but it still reaches a person
 * and still needs translating, so it may no more be prose written in place than the other.
 */
export const ISSUE = {
  PATCH_EMPTY: 'issue.patch_empty',
  TEXT_NOT_VISIBLE: 'issue.text_not_visible',
  BARCODE_DUPLICATED: 'issue.barcode_duplicated',
  RATE_SAME_CURRENCY: 'issue.rate_same_currency',
  RATE_NOT_OF_TRIP_CURRENCY: 'issue.rate_not_of_trip_currency',
  RATE_IMPLAUSIBLE_DATE: 'issue.rate_implausible_date',
  RATE_AFTER_TRIP_START: 'issue.rate_after_trip_start',
  TRIP_FINISHED_BEFORE_START: 'issue.trip_finished_before_start',
  VERDICT_UPDATED_BEFORE_RATED: 'issue.verdict_updated_before_rated',
} as const

export type IssueCode = (typeof ISSUE)[keyof typeof ISSUE]
