/**
 * Which form of a Russian numeral to use, by index into «позиция | позиции | позиций».
 *
 * vue-i18n picks a message by index, and its built-in rule is English-shaped: given three
 * forms it answers «zero / one / other», which reads «2 позиций» and «21 позиций». The
 * Russian form depends on the last *two* digits rather than the last one — 11 through 14
 * always take the third form, however the number ends.
 */
export function pluralRu(choice: number, choicesLength: number): number {
  const teen = choice % 100 >= 11 && choice % 100 <= 14
  const last = choice % 10
  const form = choice !== 0 && !teen && last === 1 ? 0 : !teen && last >= 2 && last <= 4 ? 1 : 2

  // `choicesLength` is not decoration: a key written with only two forms would otherwise be
  // handed index 2 and return undefined where a person expects text.
  return Math.min(form, choicesLength - 1)
}
