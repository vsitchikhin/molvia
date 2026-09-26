import { z } from 'zod'
import { positiveMoneyCodec } from './exchange'
import { deviceIdSchema, isoDate } from './trip'
import { exchangeDaySchema } from '#model/entities/exchange'
import { spendingTextSchema } from '#model/entities/spending'
import {
  SPENDING_CATEGORY_COLOURS,
  spendingCategoryNameSchema,
  spendingPresetSchema,
} from '#model/entities/spending-category'
import type { SpendingCategory } from '#model/entities/spending-category'
import { moneyCodec } from '#model/values/money'
import { rateCodec } from '#model/values/rates'

/** What a spending says, as the screen sends it — the same whether it is recorded or amended. */
const spendingFields = {
  spentOn: exchangeDaySchema,
  amount: positiveMoneyCodec,
  categoryId: z.uuid(),
  note: spendingTextSchema.optional(),
  place: spendingTextSchema.optional(),
}

/**
 * «Сохранить» a new spending (MOL-73). Named by the device, as an exchange is, so a spending sent
 * twice from the queue is one spending. «Not after today» is the use case's, which has the clock.
 */
export const spendingBodySchema = z.strictObject({ id: deviceIdSchema, ...spendingFields })
export type SpendingBody = z.infer<typeof spendingBodySchema>

/**
 * «Сохранить» an amended one: the spending whole as it should now be, and the version it was amended
 * over — one amended on another phone in between is a conflict rather than lost (MOL-42, В-3).
 */
export const spendingAmendBodySchema = z.strictObject({
  revision: z.int().min(1),
  ...spendingFields,
})
export type SpendingAmendBody = z.infer<typeof spendingAmendBodySchema>

/** One spending as the screen shows it, with the rate of its own day when it is in another currency. */
export const spendingViewCodec = z.strictObject({
  id: z.uuid(),
  spentOn: exchangeDaySchema,
  amount: moneyCodec,
  categoryId: z.uuid(),
  note: z.string().nullable(),
  place: z.string().nullable(),
  rate: rateCodec.nullable(),
  revision: z.int().min(1),
  amendedAt: isoDate.nullable(),
})
export type SpendingView = z.output<typeof spendingViewCodec>

/** «Добавить категорию»: one's own, named by the device, as everything written offline is. */
export const spendingCategoryBodySchema = z.strictObject({
  id: deviceIdSchema,
  name: spendingCategoryNameSchema,
})
export type SpendingCategoryBody = z.infer<typeof spendingCategoryBodySchema>

/**
 * A category as the screen names it: a preset by its key — the screen says it in its language —
 * one's own by its name and a colour of the palette. `archived` is «taken out of the choice»: still
 * the category of the spendings in it, still in their months, offered back in the list.
 */
export const spendingCategoryViewCodec = z.strictObject({
  id: z.uuid(),
  preset: spendingPresetSchema.nullable(),
  name: z.string().nullable(),
  colour: z
    .int()
    .min(0)
    .max(SPENDING_CATEGORY_COLOURS - 1)
    .nullable(),
  archived: z.boolean(),
})
export type SpendingCategoryView = z.output<typeof spendingCategoryViewCodec>

export function spendingCategoryViewOf(category: SpendingCategory): SpendingCategoryView {
  return {
    id: category.id,
    preset: category.preset,
    name: category.name,
    colour: category.colour,
    archived: category.archivedAt !== null,
  }
}

/** The person's categories in the order of the chips, the removed ones included and marked. */
export const spendingCategoriesResponseCodec = z.strictObject({
  categories: z.array(spendingCategoryViewCodec),
})
export type SpendingCategoriesResponse = z.output<typeof spendingCategoriesResponseCodec>
