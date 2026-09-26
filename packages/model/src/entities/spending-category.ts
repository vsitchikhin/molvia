import { z } from 'zod'
import { visibleLine } from '#model/support/text'

/**
 * The categories every account starts with (MOL-73, В-3), in the order the chips stand in: the
 * handoff's ten and the three the owner's sheet had besides — «Дом и быт», «Животные», «Документы».
 * A key rather than a name, so the screen can say it in any language; the order is fixed and never
 * by frequency — a chip must not move from under the finger.
 */
export const SPENDING_PRESETS = [
  'groceries',
  'cafe',
  'rent',
  'home',
  'beauty',
  'transport',
  'telecom',
  'health',
  'clothes',
  'pets',
  'leisure',
  'documents',
  'other',
] as const
export const spendingPresetSchema = z.enum(SPENDING_PRESETS)
export type SpendingPreset = z.infer<typeof spendingPresetSchema>

/** Where a finished trip's purchases land in the month (handoff 06): always the groceries. */
export const TRIP_CATEGORY: SpendingPreset = 'groceries'

/** A category's own name, when the person made it: short enough to fit a chip. */
export const SPENDING_CATEGORY_NAME_MAX = 40
export const spendingCategoryNameSchema = visibleLine(SPENDING_CATEGORY_NAME_MAX)

/**
 * How many colours a person's own categories cycle through — the screen's palette (MOL-82). A
 * number rather than a colour: which colour it is belongs to the tokens, and the schemes differ.
 */
export const SPENDING_CATEGORY_COLOURS = 8

/**
 * One of a person's spending categories (MOL-73, В-3): a preset they were given, or one they made.
 * Every account has its own list, so «у кого-то категорий больше или меньше или они вообще другие».
 *
 * Removing a category **takes it out of the choice and erases nothing** (`archivedAt`): the spendings
 * in it keep its name and colour, past months keep their sums, and it can be brought back. Otherwise
 * removing «Продукты» would rewrite every month there is.
 */
export const spendingCategorySchema = z
  .object({
    id: z.uuid(),
    actorId: z.uuid(),
    preset: spendingPresetSchema.nullable(),
    name: spendingCategoryNameSchema.nullable(),
    colour: z
      .int()
      .min(0)
      .max(SPENDING_CATEGORY_COLOURS - 1)
      .nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
  })
  // A preset is said by its key and coloured by it; one's own has a name and a colour of the
  // palette. Never both, never neither.
  .refine((category) =>
    category.preset === null
      ? category.name !== null && category.colour !== null
      : category.name === null && category.colour === null,
  )
export type SpendingCategory = z.infer<typeof spendingCategorySchema>

/**
 * The categories in the order of the chips: the presets as listed, then one's own as made. The
 * removed ones stay in the list — the spendings in them still need their names — marked by the view.
 */
export function categoryOrder(categories: readonly SpendingCategory[]): SpendingCategory[] {
  const rank = (category: SpendingCategory) =>
    category.preset === null ? SPENDING_PRESETS.length : SPENDING_PRESETS.indexOf(category.preset)
  return [...categories].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** The colour a new category of one's own takes: the palette by turn, by how many there already are. */
export function nextCategoryColour(own: readonly SpendingCategory[]): number {
  return own.filter((category) => category.preset === null).length % SPENDING_CATEGORY_COLOURS
}
