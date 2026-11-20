// What a parser of a bank's file answers (MOL-430…432): its accounts' statements, or what it refused — an
// answer, never a throw, since a `DomainError` carries no word of what was refused to the phone and the owner's
// В-4 «а» wants a status named. The upload (MOL-433) makes its codes and words of it.

/** What a refusal names. */
export type StatementRefusal =
  /** Not the bank's export, or a version of it the parser does not know: the header is no layout's. */
  | { readonly reason: 'format_unknown' }
  /** A record whose date, amount or sign does not read — the line of the file it begins on, the header's 1. */
  | { readonly reason: 'row_unreadable'; readonly row: number }
  /** A status the bank's files were never seen with (owner's В-4 «а»): a hold or a cancellation, nobody knows. */
  | { readonly reason: 'status_unknown'; readonly status: string }
  /** An account in a currency Molvia keeps no account in. */
  | { readonly reason: 'currency_unknown'; readonly currency: string }
  /** More lines than the rule weighs at once (`STATEMENT_LINES_MAX`). */
  | { readonly reason: 'too_long' }

export type StatementRead<Account> =
  | { readonly ok: true; readonly accounts: readonly Account[] }
  | { readonly ok: false; readonly refusal: StatementRefusal }

/** The longest a status or a currency is named in a refusal: as printed, never a line of the file whole. */
export const REFUSAL_STATUS_MAX = 32
export const REFUSAL_CURRENCY_MAX = 8

/**
 * `text` no longer than `max` UTF-16 units — the unit a schema's `max` counts — a pair of surrogates never cut in
 * two (review №2: cut by code points, a payee of emoji passed the cut and failed the schema).
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text
  const last = text.charCodeAt(max - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}
