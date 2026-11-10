/**
 * A count a quota keeps on the person's own day (MOL-360, MOL-362): the receipts sent, the items proposed.
 * **The day only moves on**: a day the phone names before the one the count stands on counts in that one, so
 * a day header made up walks only forward through the days that are today somewhere — three at most, for two
 * hours a day (MOL-360's review 1, adversarial А1): a price, named in `receipts.md` and `search.md`. A day
 * after it starts the count over. One rule for every such count, so a change of it reaches each.
 */
export function countOfDay(
  stored: { readonly day: string | null; readonly n: number },
  phoneDay: string,
): { readonly day: string; readonly n: number } {
  const day = stored.day !== null && stored.day > phoneDay ? stored.day : phoneDay
  return { day, n: stored.day === day ? stored.n : 0 }
}
