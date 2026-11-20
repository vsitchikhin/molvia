/**
 * The bank's page of a payment (MOL-277): the one place the app leaves itself for another site — a full navigation,
 * never the router, since the bank's page is no screen of ours. Its own module, so a test sees where it would go.
 */
export function openBankPage(url: string): void {
  window.location.assign(url)
}
