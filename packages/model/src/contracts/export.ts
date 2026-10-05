import { z } from 'zod'
import { ratePreferenceSchema } from './exchange'
import { isoDate } from './trip'
import { incomeSourceSchema } from '#model/entities/income'
import { itemKindSchema } from '#model/entities/item'
import { placeKindSchema } from '#model/entities/place'
import { receiptHeardSchema } from '#model/entities/receipt'
import { REMINDERS_OFF } from '#model/entities/reminder'
import { spendingPresetSchema } from '#model/entities/spending-category'
import { rateChoiceSchema } from '#model/entities/trip'
import { decimalFromScaled, scaledFromDecimal } from '#model/support/decimal'
import { ERROR } from '#model/support/errors'
import { currencySchema, signedMoneyCodec } from '#model/values/money'
import { RATE_DIGITS, rateProviderSchema, rateSourceSchema } from '#model/values/rates'
import { baseUnitSchema } from '#model/values/units'
import { exchangeChannelSchema } from '#model/values/market-rates'

/**
 * «Скачать мои данные» (MOL-93): everything erasure removes of a person, as one file. The codecs
 * are looser than the ones of the screens on purpose: a copy of what is stored must never be
 * refused by a rule a stored row predates — a rate outside today's band, an event type since
 * withdrawn.
 */
export const EXPORT_FORMAT = 'molvia-export'
// 2: `ratingReminders`, where the person stands on the ladder of rating reminders (MOL-101) — a
// change of what goes in is a new version (privacy.md). 3: a trip's `receipt` and `receiptSetAt`,
// the sum typed from the receipt, when it last changed and when it was first typed (MOL-78). 4: an
// exchange's `channel` (MOL-137). 5: `addedBarcodes`, the codes the person wrote to items of the
// catalogue (MOL-100). 6: the account's `remindersOff`, whether and why the bot does not remind
// (MOL-103). 7: `budgetPlans`, what the person plans a month of «Бюджет» at (MOL-117). 8: `feedback`,
// what the person wrote to the developer and the owner's replies (MOL-147). 9: `receipts`,
// the receipts photographed and what the reader laid them out into — never the photo (MOL-125).
// 10: a receipt's `city` and `tripId`, a line's item, `match`, `translation` and purchase, and
// `storeMemory`, the words the person gave the shops' memory (MOL-126). 11: a message's `pictures`,
// what is left of each once it reached the owner (MOL-167). 12: the account's `consentVersion` and
// `consentedAt`, which edition of the terms and the privacy page the person accepted, and when (MOL-95).
// 13: a receipt's `heard` and `heardAt`, how the person learned it was read — on the phone or from the
// bot — and the account's `receiptNoticesOff` and `botBlockedAt`, whether the bot is to say so and
// since when it is blocked (MOL-129). 14: the account's `analyticsOffAt` and `analyticsOnAt`, since when
// the person objects to being counted and when they last stopped objecting (MOL-96).
export const EXPORT_VERSION = 14

const day = z.iso.date()

function scaledCodec(digits: number) {
  return z.codec(z.string().max(40), z.bigint(), {
    decode: (wire, payload) => {
      const scaled = scaledFromDecimal(wire, digits)
      if (scaled === null) {
        payload.issues.push({ code: 'custom', input: wire, message: ERROR.INVALID_AMOUNT })
        return 0n
      }
      return scaled
    },
    encode: (scaled) => decimalFromScaled(scaled, digits),
  })
}

const rateNumber = scaledCodec(RATE_DIGITS)

const quantityCodec = z.codec(
  z.strictObject({ value: z.string().max(40), unit: baseUnitSchema }),
  z.strictObject({ milli: z.bigint(), unit: baseUnitSchema }),
  {
    decode: ({ value, unit }, payload) => {
      const milli = scaledFromDecimal(value, 3)
      if (milli === null) {
        payload.issues.push({ code: 'custom', input: value, message: ERROR.INVALID_QUANTITY })
      }
      return { milli: milli ?? 0n, unit }
    },
    encode: ({ milli, unit }) => ({ value: decimalFromScaled(milli, 3), unit }),
  },
)

const rateCodec = z.codec(
  z.strictObject({
    base: currencySchema,
    quote: currencySchema,
    rate: rateNumber,
    source: rateSourceSchema,
    asOf: isoDate,
  }),
  z.strictObject({
    base: currencySchema,
    quote: currencySchema,
    scaled: z.bigint(),
    source: rateSourceSchema,
    asOf: z.date(),
  }),
  {
    decode: ({ rate, ...rest }) => ({ ...rest, scaled: rate }),
    encode: ({ scaled, ...rest }) => ({ ...rest, rate: scaled }),
  },
)

const datedRateCodec = z.codec(
  z.strictObject({ rate: rateNumber, asOf: isoDate }),
  z.strictObject({ scaled: z.bigint(), asOf: z.date() }),
  {
    decode: ({ rate, asOf }) => ({ scaled: rate, asOf }),
    encode: ({ scaled, asOf }) => ({ rate: scaled, asOf }),
  },
)

const accountSchema = z.strictObject({
  id: z.uuid(),
  telegramUserId: z.int(),
  country: z.string(),
  city: z.string(),
  spendCurrency: currencySchema,
  incomeCurrency: currencySchema,
  incomeCurrencySince: isoDate.nullable(),
  ratePreference: ratePreferenceSchema,
  salaryShiftDay: z.int().nullable(),
  remindersOff: z.enum(REMINDERS_OFF).nullable(),
  receiptNoticesOff: z.boolean(),
  botBlockedAt: isoDate.nullable(),
  consentVersion: z.int().nullable(),
  consentedAt: isoDate.nullable(),
  analyticsOffAt: isoDate.nullable(),
  analyticsOnAt: isoDate.nullable(),
  sharedUntil: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
})

const sessionSchema = z.strictObject({
  id: z.uuid(),
  deviceName: z.string().nullable(),
  current: z.boolean(),
  createdAt: isoDate,
  lastSeenAt: isoDate,
  expiresAt: isoDate,
})

const loginRequestSchema = z.strictObject({
  id: z.uuid(),
  deviceName: z.string().nullable(),
  createdAt: isoDate,
  expiresAt: isoDate,
  consumedAt: isoDate.nullable(),
})

const tripSchema = z.strictObject({
  id: z.uuid(),
  placeId: z.uuid(),
  currency: currencySchema,
  rate: rateCodec.nullable(),
  rateProvider: rateProviderSchema.nullable(),
  rateJumped: z.boolean(),
  ratePrevious: datedRateCodec.nullable(),
  rateManual: datedRateCodec.nullable(),
  rateChoice: rateChoiceSchema.nullable(),
  startedAt: isoDate,
  finishedAt: isoDate.nullable(),
  finishedOnDeviceAt: isoDate.nullable(),
  // The phone's day of «Начать» and «Завершить» (MOL-121), where the phone named one.
  startedOn: day.nullable(),
  finishedOn: day.nullable(),
  accountId: z.uuid().nullable(),
  debited: signedMoneyCodec.nullable(),
  accountSetAt: isoDate.nullable(),
  // «Сумма по чеку» (MOL-78) as typed, when it last changed — taken off, the moment stays — and
  // when this sum was first typed.
  receipt: signedMoneyCodec.nullable(),
  receiptSetAt: isoDate.nullable(),
  receiptFirstAt: isoDate.nullable(),
  removedAt: isoDate.nullable(),
})

const expenseSchema = z.strictObject({
  id: z.uuid(),
  tripId: z.uuid(),
  itemId: z.uuid(),
  quantity: quantityCodec.nullable(),
  amount: signedMoneyCodec.nullable(),
  createdAt: isoDate,
})

const verdictSchema = z.strictObject({
  id: z.uuid(),
  itemId: z.uuid(),
  itemKind: itemKindSchema,
  placeId: z.uuid().nullable(),
  score: z.int(),
  review: z.string().nullable(),
  ratedAt: isoDate,
  updatedAt: isoDate,
  withdrawnAt: isoDate.nullable(),
})

/** Where the person stands on the ladder of rating reminders (MOL-101): at most one row. */
const ratingReminderSchema = z.strictObject({
  step: z.int(),
  remindedOn: day,
  remindedAt: isoDate,
  windowFrom: day,
})

const searchPickSchema = z.strictObject({
  queryKey: z.string(),
  itemId: z.uuid(),
  picks: z.int(),
  lastPickedAt: isoDate,
  admits: z.boolean(),
})

// The type is a string, not the enum of today: rows of types since withdrawn are still the
// person's (`catalogue_viewed`, `session_started`). The payload is strings only, as the
// database's CHECK holds it — the phone rebuilds the file, and a number could come back rounded.
const eventSchema = z.strictObject({
  id: z.string().regex(/^\d+$/),
  occurredAt: isoDate,
  type: z.string(),
  payload: z.record(z.string(), z.string()),
})

const exchangeFields = {
  given: signedMoneyCodec,
  received: signedMoneyCodec,
  exchangedOn: day,
  heldBefore: signedMoneyCodec.nullable(),
  note: z.string().nullable(),
  channel: exchangeChannelSchema.nullable(),
}

const exchangeSchema = z.strictObject({
  id: z.uuid(),
  ...exchangeFields,
  givenAccountId: z.uuid().nullable(),
  receivedAccountId: z.uuid().nullable(),
  accountSetAt: isoDate.nullable(),
  revision: z.int(),
  createdAt: isoDate,
  amendedAt: isoDate.nullable(),
  removedAt: isoDate.nullable(),
  earlierVersions: z.array(
    z.strictObject({ revision: z.int(), ...exchangeFields, replacedAt: isoDate }),
  ),
})

const incomeFields = {
  amount: signedMoneyCodec,
  receivedOn: day,
  heldBefore: signedMoneyCodec.nullable(),
  source: incomeSourceSchema,
  note: z.string().nullable(),
}

const incomeSchema = z.strictObject({
  id: z.uuid(),
  ...incomeFields,
  accountId: z.uuid().nullable(),
  accountSetAt: isoDate.nullable(),
  revision: z.int(),
  createdAt: isoDate,
  amendedAt: isoDate.nullable(),
  removedAt: isoDate.nullable(),
  earlierVersions: z.array(
    z.strictObject({ revision: z.int(), ...incomeFields, replacedAt: isoDate }),
  ),
})

const spendingSchema = z.strictObject({
  id: z.uuid(),
  spentOn: day,
  amount: signedMoneyCodec,
  categoryId: z.uuid(),
  note: z.string().nullable(),
  place: z.string().nullable(),
  rate: rateCodec.nullable(),
  accountId: z.uuid().nullable(),
  debited: signedMoneyCodec.nullable(),
  accountSetAt: isoDate.nullable(),
  revision: z.int(),
  createdAt: isoDate,
  amendedAt: isoDate.nullable(),
  removedAt: isoDate.nullable(),
})

/**
 * A receipt photographed (MOL-125): what the reader found at its head and its lines as read. The
 * photo and the lines cut out of it are not in the file — bytes of a picture, kept days and gone.
 */
const receiptSchema = z.strictObject({
  id: z.uuid(),
  status: z.string(),
  failure: z.string().nullable(),
  parts: z.int(),
  country: z.string(),
  language: z.string(),
  currency: currencySchema,
  capturedAt: isoDate,
  createdAt: isoDate,
  queuedAt: isoDate.nullable(),
  readingAt: isoDate.nullable(),
  readAt: isoDate.nullable(),
  attempts: z.int(),
  readerVersion: z.string().nullable(),
  layout: z.string().nullable(),
  tin: z.string().nullable(),
  printedOn: day.nullable(),
  printedTime: z.string().nullable(),
  receiptNo: z.string().nullable(),
  total: signedMoneyCodec.nullable(),
  balanced: z.boolean(),
  city: z.string().nullable(),
  recordedAt: isoDate.nullable(),
  heard: receiptHeardSchema.nullable(),
  heardAt: isoDate.nullable(),
  tripId: z.uuid().nullable(),
  removedAt: isoDate.nullable(),
  lines: z.array(
    z.strictObject({
      position: z.int(),
      printed: z.string(),
      hs: z.string().nullable(),
      sku: z.string().nullable(),
      quantity: quantityCodec.nullable(),
      price: signedMoneyCodec.nullable(),
      sum: signedMoneyCodec.nullable(),
      discount: signedMoneyCodec.nullable(),
      settled: z.boolean(),
      itemId: z.uuid().nullable(),
      match: z.string().nullable(),
      translation: z.string().nullable(),
      expenseId: z.uuid().nullable(),
    }),
  ),
})

const spendingCategorySchema = z.strictObject({
  id: z.uuid(),
  preset: spendingPresetSchema.nullable(),
  name: z.string().nullable(),
  colour: z.int().nullable(),
  archivedAt: isoDate.nullable(),
  createdAt: isoDate,
})

const monthRateSchema = z.strictObject({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  rate: rateCodec,
})

const budgetPlanSchema = z.strictObject({
  categoryId: z.uuid().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}$/),
  plan: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('amount'), amount: signedMoneyCodec }),
      z.strictObject({ kind: z.literal('share'), percent: z.int() }),
    ])
    .nullable(),
  updatedAt: isoDate,
})

const moneyAccountSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  currency: currencySchema,
  savings: z.boolean(),
  start: signedMoneyCodec,
  startOn: day,
  revision: z.int(),
  createdAt: isoDate,
  archivedAt: isoDate.nullable(),
  removedAt: isoDate.nullable(),
})

const accountCheckSchema = z.strictObject({
  id: z.uuid(),
  accountId: z.uuid(),
  checkedOn: day,
  fact: signedMoneyCodec,
  counted: signedMoneyCodec,
  createdAt: isoDate,
})

const proposedItemSchema = z.strictObject({
  id: z.uuid(),
  kind: itemKindSchema,
  name: z.string(),
  note: z.string().nullable(),
  defaultUnit: baseUnitSchema,
  typicalQuantity: quantityCodec.nullable(),
  barcodes: z.array(z.string()),
  createdAt: isoDate,
})

/**
 * A code the person wrote to an item, theirs or anyone's (MOL-100): it says they held the package.
 * The code stays in the catalogue when they are erased — only its author goes.
 */
// `barcode`, not `code`: a key named `code` is what the file's guard against secrets looks for — a
// login's code.
const addedBarcodeSchema = z.strictObject({
  barcode: z.string(),
  itemId: z.uuid(),
  addedAt: isoDate,
})

/**
 * A word the person gave a shop's memory (MOL-126): this article, or this line as printed, at the
 * seller with this tax number is this item, at this shelf price. Shared — others read the item, never
 * who said it — and kept without its author after erasure.
 */
const storeMemorySchema = z.strictObject({
  tin: z.string(),
  kind: z.string(),
  key: z.string(),
  itemId: z.uuid(),
  price: signedMoneyCodec.nullable(),
  writtenAt: isoDate,
})

/**
 * A message to the developer (MOL-147), a thread's continuation too, with the owner's replies to it.
 * `thread` is the number of the thread's first message, `inReplyTo` the reply a continuation answers.
 */
const feedbackSchema = z.strictObject({
  number: z.int(),
  kind: z.string(),
  text: z.string(),
  locale: z.string(),
  pageBuild: z.string().nullable(),
  apiBuild: z.string(),
  route: z.string().nullable(),
  platform: z.string().nullable(),
  errorCode: z.string().nullable(),
  fromError: z.boolean(),
  thread: z.int().nullable(),
  inReplyTo: z.int().nullable(),
  createdAt: isoDate,
  replies: z.array(
    z.strictObject({
      number: z.int(),
      text: z.string(),
      delivered: z.string().nullable(),
      createdAt: isoDate,
    }),
  ),
  /**
   * The pictures that went with it (MOL-167): never the picture — its bytes are kept only until the
   * owner's Telegram has them (В-1) — but its place, where it came from, its size and when it went.
   */
  pictures: z.array(
    z.strictObject({
      position: z.int(),
      source: z.string(),
      width: z.int(),
      height: z.int(),
      bytes: z.int().nullable(),
      createdAt: isoDate,
      sentAt: isoDate.nullable(),
    }),
  ),
})

/** Names for the ids the person's rows point at — shared data, given only so the file reads. */
const catalogueSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.uuid(), kind: itemKindSchema, name: z.string() })),
  places: z.array(
    z.strictObject({
      id: z.uuid(),
      kind: placeKindSchema,
      name: z.string(),
      country: z.string(),
      city: z.string(),
    }),
  ),
})

/** What is read of a person, before the file is dated. */
export const exportContentCodec = z.strictObject({
  account: accountSchema,
  sessions: z.array(sessionSchema),
  loginRequests: z.array(loginRequestSchema),
  trips: z.array(tripSchema),
  expenses: z.array(expenseSchema),
  verdicts: z.array(verdictSchema),
  searchPicks: z.array(searchPickSchema),
  ratingReminders: z.array(ratingReminderSchema),
  events: z.array(eventSchema),
  exchanges: z.array(exchangeSchema),
  incomes: z.array(incomeSchema),
  spendings: z.array(spendingSchema),
  receipts: z.array(receiptSchema),
  spendingCategories: z.array(spendingCategorySchema),
  monthRates: z.array(monthRateSchema),
  budgetPlans: z.array(budgetPlanSchema),
  moneyAccounts: z.array(moneyAccountSchema),
  accountChecks: z.array(accountCheckSchema),
  proposedItems: z.array(proposedItemSchema),
  addedBarcodes: z.array(addedBarcodeSchema),
  storeMemory: z.array(storeMemorySchema),
  feedback: z.array(feedbackSchema),
  catalogue: catalogueSchema,
})
export type ExportContent = z.output<typeof exportContentCodec>

export const exportFileCodec = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: isoDate,
  ...exportContentCodec.shape,
})
export type ExportFile = z.output<typeof exportFileCodec>
