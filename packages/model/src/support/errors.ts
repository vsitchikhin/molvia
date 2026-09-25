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
  /**
   * «Начать поход» while another trip is still open. Added in MOL-21: one open trip per person,
   * and the choice between the two is the person's, not the server's — continue the open one,
   * or finish it and start this. So the server refuses rather than deciding either way, and
   * the screen reads exactly this code to ask.
   */
  TRIP_OPEN: 'error.trip_open',
  TRIP_CONTEXT_REQUIRED: 'error.trip_context_required',
  INTERNAL: 'error.internal',
  LOGIN_UNAVAILABLE: 'error.login_unavailable',
  LOGIN_FORBIDDEN: 'error.login_forbidden',
  LOGIN_RATE_LIMITED: 'error.login_rate_limited',
  LOGIN_DISABLED: 'error.login_disabled',
  BOT_UNAUTHORIZED: 'error.bot_unauthorized',
  /**
   * An exchange dated after today in Yerevan (MOL-40). A rule of the clock, so the use case holds
   * it rather than the schema — the same line `exchangeRateSchema` draws for «not from the future».
   */
  EXCHANGE_IN_FUTURE: 'error.exchange_in_future',
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
  /** A query string that did not parse. Not BODY_INVALID: a `GET` has no body to blame. */
  QUERY_INVALID: 'issue.query_invalid',
  /** An identifier in the path that did not parse — the address is wrong, not the body. */
  PATH_INVALID: 'issue.path_invalid',
  RESPONSE_INVALID: 'issue.response_invalid',
  HEALTH_CONTRADICTS_ITSELF: 'issue.health_contradicts_itself',
  PATCH_EMPTY: 'issue.patch_empty',
  TEXT_NOT_VISIBLE: 'issue.text_not_visible',
  BARCODE_DUPLICATED: 'issue.barcode_duplicated',
  QUANTITY_FRACTIONAL_PIECE: 'issue.quantity_fractional_piece',
  RATE_SAME_CURRENCY: 'issue.rate_same_currency',
  RATE_NOT_OF_TRIP_CURRENCY: 'issue.rate_not_of_trip_currency',
  RATE_IMPLAUSIBLE_DATE: 'issue.rate_implausible_date',
  /**
   * A rate kept beside a snapshot that does not belong there: not the same pair, the wrong
   * source, or beside a snapshot that never jumped (MOL-39).
   */
  SIDE_RATE_UNMATCHED: 'issue.side_rate_unmatched',
  /** A choice of rate on a trip with nothing to choose, or naming a rate the trip does not hold. */
  RATE_CHOICE_NOT_HELD: 'issue.rate_choice_not_held',
  /**
   * A snapshot whose publisher is unknown, or a publisher named for a rate nobody published —
   * none, or the person's own (MOL-22).
   */
  RATE_PROVIDER_UNMATCHED: 'issue.rate_provider_unmatched',
  TRIP_FINISHED_BEFORE_START: 'issue.trip_finished_before_start',
  VERDICT_UPDATED_BEFORE_RATED: 'issue.verdict_updated_before_rated',
  VERDICT_PLACE_NOT_FOR_KIND: 'issue.verdict_place_not_for_kind',
  /** An exchange that gives and receives one currency: nothing was exchanged (MOL-40). */
  EXCHANGE_SAME_CURRENCY: 'issue.exchange_same_currency',
  /** What was held before an exchange, named in a currency other than the one received. */
  EXCHANGE_HELD_NOT_RECEIVED: 'issue.exchange_held_not_received',
} as const

export type IssueCode = (typeof ISSUE)[keyof typeof ISSUE]
