import { z } from 'zod'
import { visibleLine } from '#model/support/text'

/**
 * The categories every account starts with (MOL-73, В-3), in the order the chips stand in: the
 * handoff's ten and the three the owner's sheet had besides — «Дом и быт», «Животные», «Документы».
 * A key rather than a name, so the screen can say it in any language. Their order is the order of
 * everything but the choice: the budget, the charts, «Категории» (`categoryOrder`). The chips of a
 * spending stand by frequency (`frequentCategories`, MOL-198).
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
 * The icons a person's own category may take (MOL-285): the tag every one of them had before, the
 * owner's twenty-three of daily life, and the presets' own (В-3 «б»), so «Кафе на работе» can have
 * the fork and knife in a colour of its own. A key rather than an icon's name, as a preset is: the
 * set is the domain's, the drawing the phone's. A key added is a migration — the database checks it.
 */
export const SPENDING_ICONS = [
  'tag',
  'gift',
  'sport',
  'study',
  'kids',
  'taxi',
  'car',
  'fuel',
  'travel',
  'coffee',
  'bar',
  'games',
  'books',
  'music',
  'phone',
  'tech',
  'repair',
  'flowers',
  'charity',
  'subscriptions',
  'bank',
  'languages',
  'dentist',
  'utilities',
  ...SPENDING_PRESETS,
] as const
export const spendingIconSchema = z.enum(SPENDING_ICONS)
export type SpendingIcon = z.infer<typeof spendingIconSchema>

/** What one's own category was drawn with before it could choose, and what a new one starts with. */
export const DEFAULT_SPENDING_ICON: SpendingIcon = 'tag'

export const spendingCategoryColourSchema = z
  .int()
  .min(0)
  .max(SPENDING_CATEGORY_COLOURS - 1)

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
    colour: spendingCategoryColourSchema.nullable(),
    icon: spendingIconSchema.nullable(),
    archivedAt: z.date().nullable(),
    createdAt: z.date(),
  })
  // A preset is said, coloured and drawn by its key; one's own has a name, a colour of the palette
  // and an icon of the set. Never both, never neither.
  .refine((category) =>
    category.preset === null
      ? category.name !== null && category.colour !== null && category.icon !== null
      : category.name === null && category.colour === null && category.icon === null,
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

/**
 * How far back the chips of a spending count a category's use (MOL-198, owner's Р-16 of MOL-118): 90
 * calendar days, today among them.
 */
export const CATEGORY_FREQUENCY_DAYS = 90

/**
 * The live categories a person chose in the window, the most used first (MOL-198, Ф-17): 21 chips in
 * six rows pushed the sheet's form off the screen, and two rows of the frequent ones keep «Сохранить
 * трату» under the thumb. A tie, and every category not used at all, stands in `categoryOrder` — the
 * presets as listed, a newcomer's whole order. The chips take this order when the sheet opens and
 * keep it while it is up: a chip does not move from under the finger (MOL-82, by its sense).
 */
export function frequentCategories(
  categories: readonly SpendingCategory[],
  uses: ReadonlyMap<string, number>,
): string[] {
  const used = (category: SpendingCategory) => uses.get(category.id) ?? 0
  return categoryOrder(categories)
    .filter((category) => category.archivedAt === null && used(category) > 0)
    .sort((a, b) => used(b) - used(a))
    .map((category) => category.id)
}

/** The colour a new category of one's own takes: the palette by turn, by how many there already are. */
export function nextCategoryColour(own: readonly Pick<SpendingCategory, 'preset'>[]): number {
  return own.filter((category) => category.preset === null).length % SPENDING_CATEGORY_COLOURS
}
