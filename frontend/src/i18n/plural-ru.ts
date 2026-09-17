/**
 * Which form of a Russian numeral to use, by index into «позиция | позиции | позиций».
 *
 * vue-i18n picks a message by index, and its built-in rule is English-shaped: given three
 * forms it answers «zero / one / other», which reads «2 позиций» and «21 позиций». The
 * Russian form depends on the last *two* digits rather than the last one — 11 through 14
 * always take the third form, however the number ends.
 */
export function pluralRu(choice: number, choicesLength: number): number {
  // «Unknown how many» — the third form, and this branch is what the runtime actually hits.
  //
  // vue-i18n coerces a non-number to -1 *before* calling the rule, so `NaN` and `Infinity`
  // never reach here: what arrives is -1. A counter divided by an empty answer therefore
  // renders the noun with no number — « позиций» — and the plural form at least stays
  // impersonal instead of claiming «одна». `Math.abs` alone turned that into « позиция»,
  // which reads like a real count of one.
  //
  // A genuine -1 is not a case in 0.1 either, so treating both the same costs nothing.
  if (!Number.isFinite(choice) || choice < 0) return clamp(2, choicesLength)

  // A fraction is not exotic here: loose goods are kilograms and litres, so «1,5 кг» arrives
  // long before the fortieth screen. Russian treats any fractional amount as the second form
  // («1,5 позиции»), which is what the remainder below cannot express on its own.
  if (!Number.isInteger(choice)) return clamp(1, choicesLength)

  const teen = choice % 100 >= 11 && choice % 100 <= 14
  const last = choice % 10
  const form = choice !== 0 && !teen && last === 1 ? 0 : !teen && last >= 2 && last <= 4 ? 1 : 2

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
