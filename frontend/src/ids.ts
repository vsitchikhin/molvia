/**
 * A row named by the device (MOL-21): the trip it starts, the purchase it writes. Lower case
 * only — the server refuses anything else, and the phone has to find its own row in the answer.
 *
 * `randomUUID` exists only in a secure context, and a phone on the LAN over plain http —
 * `PWA_EXPOSE=1 make dev` without `make certs` — is not one (MOL-24, Р-6). `getRandomValues` is
 * there everywhere, so the identifier is built from it when the shorter way is missing: without
 * this a tap at a shelf throws inside its own handler and nothing happens on screen (В2-10).
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID().toLowerCase()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
