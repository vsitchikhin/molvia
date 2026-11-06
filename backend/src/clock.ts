/**
 * A clock that never steps back (MOL-359, adversarial А1, Б1) — the minute of an address
 * (`addressMinute`) and the phone's hours (`record-failure.ts`). The machine's wall clock does, at a correction of NTP: stepped
 * back by ten minutes, it held an address for eleven and its IP in memory as long, against «через
 * минуту» and the privacy page's «на пару минут» and «час»; stepped forward, it gave five more starts
 * in the same second, and a sender sixty more rows.
 */
export const monotonic = (): number => performance.now()
