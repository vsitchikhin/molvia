/** How many single-letter insertions, deletions and substitutions make one string the other, by code point. */
export function levenshtein(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      )
    }
    previous = row
  }
  return previous[y.length] ?? 0
}
