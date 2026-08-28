/**
 * Domain errors come from this registry, never from strings written in place.
 * The codes double as i18n keys, so a message is never hardcoded on the way to a user.
 */
export const ERROR = {
  INVALID_AMOUNT: 'error.invalid_amount',
  INVALID_QUANTITY: 'error.invalid_quantity',
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
