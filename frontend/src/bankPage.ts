/**
 * The bank's page of a payment (MOL-277): the one place the app leaves itself for another site — a full navigation,
 * never the router, since the bank's page is no screen of ours. Its own module, so a test sees where it would go.
 */
export function openBankPage(url: string): void {
  window.location.assign(url)
}

/**
 * Back from the bank's page, a payment the bank has not said of yet is asked again this often, this many times — a
 * minute; the server's own minute asks it after that (requirement 6).
 */
export const PAY_DONE_ASK_MS = 5_000
export const PAY_DONE_ASKS = 12
