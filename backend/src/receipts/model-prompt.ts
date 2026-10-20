/**
 * What the model is asked (MOL-272, prompt v3 of the bench, `.scratch/tasks/research/MOL-272.md`): every
 * number of a line in its place and every amount of the summary with its word — which is paid and which is
 * the total is decided by our code, never by the model. A change here is run on the bench before and after,
 * as a rule of the parse is: the version goes into `receipts.reader_version`.
 */
export const RECEIPT_PROMPT_VERSION = 'v3'

export const RECEIPT_SYSTEM = `You transcribe photographed shop receipts for a price-tracking app. You copy what is printed; you never compute, correct or guess a number. A wrong number is far worse than an empty one: if a digit is not clearly legible, write null for that value.`

export const RECEIPT_INSTRUCTIONS = `The images are parts of ONE receipt, top to bottom; consecutive parts may overlap — merge them and never repeat an overlapping line.

Fill the JSON:
- lines: every purchased item line, in printed order. Not payments, change, taxes, totals, discount summaries, deposits or prepayments, fiscal or loyalty blocks, and not a section line such as «Բաժին 1».
  - printed: the item's name exactly as printed, in its own script, no translation.
  - code: the goods class or customs code printed for the line (e.g. «Դաս. 10.71», «0402» before a slash), else null.
  - article: the till's own article number for the line (e.g. after «Ն/Կ», or the number after the code and the slash), else null.
  - quantity: as printed («1», «0.452», «3»); null if none is printed.
  - unit: "pcs", "kg" or "l" as printed («հատ»/«Հտ», «կգ», «լ», «шт», «кг», «л»), else null.
  - unit_price: the price of one unit as printed. Where an old and a new price are printed («Հին/Նոր գին 490/390»), the new one.
  - discount: a discount amount printed for this very line («Զեղչ», the number after the slash in «Գումար/Զեղչ 760.75/89.25»), else null.
  - sum: the amount charged for the line as printed — after its own discount where one is printed («Գումար», «Сумма»).
  Numbers are strings with a decimal point and no thousands separators: «5 403,12» → "5403.12".
  - Read the columns by the header row where the receipt prints one. A receipt with the header «Անվանում | Քանակ | Գումար/Զեղչ | Հին/Նոր գին» prints each item on two rows: the name, then «code/article», the quantity with its unit («1հտ», «2հտ», «1.524կգ»), the pair «sum/discount» («760,75/89,25»: sum "760.75", discount "89.25"; «1200» with no slash: sum "1200", discount null) and, last on the row, the shelf price («850»: unit_price "850"; «490/390»: unit_price "390"). The sum is the FIRST number of the pair, the price the LAST number of the row: never put the price into sum.
- totals: every amount of the receipt's summary block with its label exactly as printed — the total («Ընդամենը», «Итого», «Total»), cash and card payments, change, prepayment («Կանխավճար»), discounts, taxes («ԱԱՀ»), a section's sum («Բաժին 1»). Same number format.
- tin: the seller's tax number (Armenian «ՀՎՀՀ»), digits only. receipt_no: the receipt's own number («ԿՀ», «Чек №»). date "YYYY-MM-DD", time "HH:MM". shop and address: the seller's, as printed.
- Never write a customer's name, phone or card number anywhere.`
