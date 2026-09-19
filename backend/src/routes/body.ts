import type { ZodError, ZodType } from 'zod'

/**
 * A request body that did not parse, and only that.
 *
 * The handler used to map every ZodError to 400, which meant a row read from the database
 * and no longer matching its schema — a half-applied migration, a widened enum — was
 * reported to the client as a field it never sent, with a 4xx and no log line at all.
 * The two are told apart by where the parse happened, not by the class thrown.
 */
export class InvalidBody extends Error {
  readonly issues: ZodError['issues']

  constructor(error: ZodError) {
    super('the request body did not parse')
    this.name = 'InvalidBody'
    this.issues = error.issues
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new InvalidBody(parsed.error)
  return parsed.data
}

/**
 * The same seam for a query string. It throws `InvalidBody` too: what the class separates is
 * «parsed from the request» from «a row that stopped matching its schema», and a query string
 * is parsed from the request. The code the reply carries comes from the schema, not the name.
 */
export function parseQuery<T>(schema: ZodType<T>, query: unknown): T {
  return parseBody(schema, query)
}

/** And for the parameters of a path, for the same reason. */
export function parseParams<T>(schema: ZodType<T>, params: unknown): T {
  return parseBody(schema, params)
}
