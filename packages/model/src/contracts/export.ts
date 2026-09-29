import { z } from 'zod'
import { ratePreferenceSchema } from './exchange'
import { isoDate } from './trip'
import { incomeSourceSchema } from '#model/entities/income'
import { itemKindSchema } from '#model/entities/item'
import { placeKindSchema } from '#model/entities/place'
import { spendingPresetSchema } from '#model/entities/spending-category'
import { rateChoiceSchema } from '#model/entities/trip'
import { decimalFromScaled, scaledFromDecimal } from '#model/support/decimal'
import { ERROR } from '#model/support/errors'
import { currencySchema, signedMoneyCodec } from '#model/values/money'
import { RATE_DIGITS, rateProviderSchema, rateSourceSchema } from '#model/values/rates'
import { baseUnitSchema } from '#model/values/units'

/**
 * «Скачать мои данные» (MOL-93): everything erasure removes of a person, as one file. The codecs
 * are looser than the ones of the screens on purpose: a copy of what is stored must never be
 * refused by a rule a stored row predates — a rate outside today's band, an event type since
 * withdrawn.
 */
export const EXPORT_FORMAT = 'molvia-export'
export const EXPORT_VERSION = 1

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
  accountId: z.uuid().nullable(),
  debited: signedMoneyCodec.nullable(),
  accountSetAt: isoDate.nullable(),
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

const searchPickSchema = z.strictObject({
  queryKey: z.string(),
  itemId: z.uuid(),
  picks: z.int(),
  lastPickedAt: isoDate,
  admits: z.boolean(),
})

// The type is a string, not the enum of today: rows of types since withdrawn are still the
// person's (`catalogue_viewed`, `session_started`).
const eventSchema = z.strictObject({
  id: z.string().regex(/^\d+$/),
  occurredAt: isoDate,
  type: z.string(),
  payload: z.json(),
})

const exchangeFields = {
  given: signedMoneyCodec,
  received: signedMoneyCodec,
  exchangedOn: day,
  heldBefore: signedMoneyCodec.nullable(),
  note: z.string().nullable(),
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
  events: z.array(eventSchema),
  exchanges: z.array(exchangeSchema),
  incomes: z.array(incomeSchema),
  spendings: z.array(spendingSchema),
  spendingCategories: z.array(spendingCategorySchema),
  monthRates: z.array(monthRateSchema),
  moneyAccounts: z.array(moneyAccountSchema),
  accountChecks: z.array(accountCheckSchema),
  proposedItems: z.array(proposedItemSchema),
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
