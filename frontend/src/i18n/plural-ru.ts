/**
 * Which form of a Russian numeral to use, by index into «позиция | позиции | позиций».
 *
 * vue-i18n picks a message by index, and its built-in rule is English-shaped: given three
 * forms it answers «zero / one / other», which reads «2 позиций» and «21 позиций». The
 * Russian form depends on the last *two* digits rather than the last one — 11 through 14
 * always take the third form, however the number ends.
 */
export function pluralRu(choice: number, choicesLength: number): number {
  // The rule this replaces takes `Math.abs`, and a replacement that behaves differently from
  // what it replaces is a trap. A negative count is not a real case today, but «-1 позиций»
  // would be wrong the day it appears.
  const count = Math.abs(choice)

  // A fraction is not exotic here: loose goods are kilograms and litres, so «1,5 кг» arrives
  // long before the fortieth screen. Russian treats any fractional amount as the second form
  // («1,5 позиции»), which is what the remainder below cannot express on its own.
  // NaN and Infinity are the shape a counter takes when it was divided by an empty answer —
  // without this they render the noun with no number at all: « позиций».
  if (!Number.isFinite(count)) return clamp(2, choicesLength)
  if (!Number.isInteger(count)) return clamp(1, choicesLength)

  const teen = count % 100 >= 11 && count % 100 <= 14
  const last = count % 10
  const form = count !== 0 && !teen && last === 1 ? 0 : !teen && last >= 2 && last <= 4 ? 1 : 2

  return clamp(form, choicesLength)
}

/**
 * `choicesLength` is not decoration: a key written with only two forms would otherwise be
 * handed index 2 and return undefined where a person expects text.
 *
 * This is a runtime seatbelt, not a check — it turns a missing form into a wrong one rather
 * than a crash. What guards against writing such a key at all is the dictionary test that
 * counts the forms of every pluralised value.
 */
function clamp(form: number, choicesLength: number): number {
  return Math.min(form, choicesLength - 1)
}
