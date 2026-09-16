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
  /**
   * Someone else's row already holds what this one claims. Added in MOL-7: a unique
   * constraint speaks about *other rows* of the table, and the domain — which sees only the
   * input in front of it — has no way to check that. Without this code such a collision came
   * back as a 500, and the path that meets it is an ordinary day rather than a defect:
   * a scanned barcode that already belongs to another item.
   */
  CONFLICT: 'error.conflict',
  /**
   * The request did not name a subject the server could find. Added in MOL-8, and the line
   * between it and CONFLICT is worth keeping: CONFLICT is about *other rows of the table*,
   * which the domain cannot see; NO_ACTOR is about a subject that is absent altogether,
   * which neither the domain nor the database can know — it is a fact of the request.
   *
   * Three cases answer with it and deliberately look identical: no header at all, a header
   * that is not a uuid, and a well-formed uuid with no row behind it. A difference between
   * them is how someone else's identifiers get guessed by comparing replies. It is also what
   * the first visit answers when the invite code is missing or wrong.
   */
  NO_ACTOR: 'error.no_actor',
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
 * The same, for zod issues — shape errors, which never become a DomainError. A shape the
 * domain already has a name for reuses that name: a malformed amount is ERROR.INVALID_AMOUNT
 * wherever it is found, and one fact with two keys would be worse than the split is good.
 */
export const ISSUE = {
  BODY_INVALID: 'issue.body_invalid',
  RESPONSE_INVALID: 'issue.response_invalid',
  HEALTH_CONTRADICTS_ITSELF: 'issue.health_contradicts_itself',
  PATCH_EMPTY: 'issue.patch_empty',
  TEXT_NOT_VISIBLE: 'issue.text_not_visible',
  BARCODE_DUPLICATED: 'issue.barcode_duplicated',
  QUANTITY_FRACTIONAL_PIECE: 'issue.quantity_fractional_piece',
  RATE_SAME_CURRENCY: 'issue.rate_same_currency',
  RATE_NOT_OF_TRIP_CURRENCY: 'issue.rate_not_of_trip_currency',
  RATE_IMPLAUSIBLE_DATE: 'issue.rate_implausible_date',
  TRIP_FINISHED_BEFORE_START: 'issue.trip_finished_before_start',
  VERDICT_UPDATED_BEFORE_RATED: 'issue.verdict_updated_before_rated',
  VERDICT_PLACE_NOT_FOR_KIND: 'issue.verdict_place_not_for_kind',
} as const

export type IssueCode = (typeof ISSUE)[keyof typeof ISSUE]
