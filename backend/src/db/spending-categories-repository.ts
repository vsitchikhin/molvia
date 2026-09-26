import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  DomainError,
  ERROR,
  SPENDING_PRESETS,
  nameIdentity,
  nextCategoryColour,
  spendingCategorySchema,
} from '@molvia/model'
import type { SpendingCategory, SpendingCategoryBody } from '@molvia/model'
import { translateFailures } from './failure'
import type { Conn } from './index'
import { idOrNull } from './rows'
import { spendingCategories } from './schema'

/**
 * The owner's spending categories (MOL-73, В-3). Every account is given the presets the first time
 * it asks, so accounts made before this table and after it are one case; one's own are named by the
 * device; removing is taking out of the choice, never a delete.
 */
export interface SpendingCategoryRepository {
  /** Every category of the owner, the removed ones too — after giving the presets, if not yet given. */
  list(actorId: string): Promise<readonly SpendingCategory[]>

  /**
   * «Добавить категорию». The same identifier and name again is a repeat (`created: false`); the
   * same identifier with another name, or someone else's, is `CONFLICT`; a name another live one of
   * the owner's already has is `SPENDING_CATEGORY_TAKEN`.
   */
  add(
    actorId: string,
    input: SpendingCategoryBody,
  ): Promise<{ category: SpendingCategory; created: boolean }>

  /** Takes the owner's category out of the choice; false when there is no such category of theirs. */
  archive(actorId: string, id: string): Promise<boolean>

  /** Brings a removed category back into the choice; false when there is no such category of theirs. */
  restore(actorId: string, id: string): Promise<boolean>
}

type Row = typeof spendingCategories.$inferSelect

/** One owner's names are decided one at a time: a check and its write are one step. */
function lockOwner(actorId: string) {
  return sql`select pg_advisory_xact_lock(hashtext('spending_categories'), hashtext(${actorId}))`
}

function toCategory(row: Row): SpendingCategory {
  return spendingCategorySchema.parse(row)
}

export function createSpendingCategoryRepository(db: Conn): SpendingCategoryRepository {
  async function all(
    actorId: string,
    conn: Pick<Conn, 'select'> = db,
  ): Promise<SpendingCategory[]> {
    const rows = await conn
      .select()
      .from(spendingCategories)
      .where(eq(spendingCategories.actorId, actorId))
    return rows.map(toCategory)
  }

  async function given(actorId: string): Promise<SpendingCategory[]> {
    // One statement for all thirteen, and a preset already there is skipped rather than refused:
    // two tabs asking at once give one list.
    await db
      .insert(spendingCategories)
      .values(
        SPENDING_PRESETS.map((preset) => ({
          id: sql`gen_random_uuid()`,
          actorId,
          preset,
        })),
      )
      .onConflictDoNothing()
    return all(actorId)
  }

  /** Whether another live category of one's own already goes by this name. */
  function nameTaken(owned: readonly SpendingCategory[], name: string, except?: string): boolean {
    const identity = nameIdentity(name)
    return owned.some(
      (category) =>
        category.id !== except &&
        category.archivedAt === null &&
        category.name !== null &&
        nameIdentity(category.name) === identity,
    )
  }

  return {
    list: given,

    async add(actorId, input) {
      await given(actorId)
      return translateFailures(() =>
        db.transaction(async (tx) => {
          // The name is checked and written under the owner's lock: two phones adding «Такси» at
          // once each saw no «Такси» and both wrote one (adversarial Д7).
          await tx.execute(lockOwner(actorId))
          const owned = await all(actorId, tx)
          const same = owned.find((category) => category.id === input.id)
          if (same) {
            if (same.name !== input.name) throw new DomainError(ERROR.CONFLICT)
            return { category: same, created: false }
          }
          if (nameTaken(owned, input.name)) throw new DomainError(ERROR.SPENDING_CATEGORY_TAKEN)

          const [inserted] = await tx
            .insert(spendingCategories)
            .values({
              id: input.id,
              actorId,
              name: input.name,
              colour: nextCategoryColour(owned),
            })
            .onConflictDoNothing({ target: spendingCategories.id })
            .returning()
          // Taken by an identifier of someone else's: a device does not choose another's name.
          if (!inserted) throw new DomainError(ERROR.CONFLICT)
          return { category: toCategory(inserted), created: true }
        }),
      )
    },

    async archive(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      const [row] = await db
        .select({ archivedAt: spendingCategories.archivedAt })
        .from(spendingCategories)
        .where(and(eq(spendingCategories.id, own), eq(spendingCategories.actorId, actorId)))
      if (!row) return false
      await db
        .update(spendingCategories)
        .set({ archivedAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(spendingCategories.id, own),
            eq(spendingCategories.actorId, actorId),
            isNull(spendingCategories.archivedAt),
          ),
        )
      return true
    },

    async restore(actorId, id) {
      const own = idOrNull(id)
      if (own === null) return false
      return db.transaction(async (tx) => {
        await tx.execute(lockOwner(actorId))
        const owned = await all(actorId, tx)
        const category = owned.find((candidate) => candidate.id === own)
        if (!category) return false
        // Brought back beside a live one of the same name, the chips would hold two «Такси».
        if (category.name !== null && nameTaken(owned, category.name, own)) {
          throw new DomainError(ERROR.SPENDING_CATEGORY_TAKEN)
        }
        await tx
          .update(spendingCategories)
          .set({ archivedAt: null })
          .where(
            and(
              eq(spendingCategories.id, own),
              eq(spendingCategories.actorId, actorId),
              isNotNull(spendingCategories.archivedAt),
            ),
          )
        return true
      })
    },
  }
}
