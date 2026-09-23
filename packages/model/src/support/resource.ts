/**
 * What an address of a resource may look like, in one place.
 *
 * It was three — the path parser, the verdict's path schema and the identifier a read passes to
 * a query — and they had already drifted: two folded the case and the third did not (MOL-25,
 * З-6). The same thing happened twice to `INVISIBLE` in `text.ts`, and each time a copy that
 * disagreed with its twin cost a 500, so the rule lives once and a test holds its callers to it.
 *
 * The case is folded rather than refused because Postgres compares uuids without case and
 * answers in lower case: a path spelled `AB12…` would otherwise reach a row whose identifier
 * comes back `ab12…`, and the device would not recognise its own row in the reply. Bodies that
 * *create* a row are the other way round and stay strict (`deviceIdSchema`), so the answer and
 * the draft on the phone agree on one spelling.
 */
const RESOURCE_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i

/** Whether the value could address a row at all. */
export function isResourceId(value: unknown): value is string {
  return typeof value === 'string' && RESOURCE_ID.test(value)
}

/** The address as every reader of it spells one, or `null` when it could never match a row. */
export function resourceIdOf(value: unknown): string | null {
  return isResourceId(value) ? value.toLowerCase() : null
}
