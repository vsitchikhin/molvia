import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Db } from '@/db'

/** The role postgres_exporter logs in as (MOL-366): counters and nothing of a person. */
export const METRICS_ROLE = 'molvia_metrics'

/** What a role so bounded still holds (В-3 «а»): enough for one exporter, not for the API's hundred. */
const CONNECTION_LIMIT = 3
const STATEMENT_TIMEOUT = '5s'

const ITERATIONS = 4096
const VERIFIER = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/

/**
 * The password as Postgres stores it, counted here as `psql \password` counts it (Р-1): the
 * statement carries the verifier, never the password, which a failed `ALTER ROLE` would write
 * into Postgres's log and which `pg_stat_activity` — what `pg_monitor` reads — shows while it runs.
 * A verifier opens nothing. The password is printable ASCII (`metricsDbPasswordSchema`), which
 * SASLprep leaves as it is, so libpq on the exporter's side counts the same keys.
 */
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations = ITERATIONS,
): string {
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const clientKey = createHmac('sha256', salted).update('Client Key').digest()
  const storedKey = createHash('sha256').update(clientKey).digest('base64')
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64')
  return `SCRAM-SHA-256$${String(iterations)}:${salt.toString('base64')}$${storedKey}:${serverKey}`
}

/** Whether the stored verifier is of this password: counted again with its own salt. */
function isVerifierOf(stored: string | null, password: string): boolean {
  const parts = stored === null ? null : VERIFIER.exec(stored)
  if (!parts) return false
  return scramVerifier(password, Buffer.from(parts[2] ?? '', 'base64'), Number(parts[1])) === stored
}

/**
 * The exporter's role brought to its form at every start of the API (MOL-366, В-1 «а»), never by a
 * migration: a role is the cluster's, a migration runs in each of its databases, and `pg_dump`
 * carries no role — a machine restored from a copy would have none behind a journal that says
 * everything ran. Made if missing, its attributes and `pg_monitor` set again — a role changed by
 * hand comes back — and its password written only when another (Р-2): then whatever it opened
 * before is closed, so a connection made with a leaked password does not outlive the rotation.
 * Returns whether the password changed.
 */
export async function ensureMetricsRole(db: Db, password: string): Promise<boolean> {
  const changed = await db.transaction(async (tx) => {
    // Two databases of one cluster, two starts: «already there» is the answer, not a failure.
    await tx.execute(
      sql.raw(`do $$ begin create role ${METRICS_ROLE} login;
        exception when duplicate_object then null; end $$`),
    )
    await tx.execute(
      sql.raw(`alter role ${METRICS_ROLE} login inherit nosuperuser nocreatedb nocreaterole
        noreplication nobypassrls connection limit ${String(CONNECTION_LIMIT)}`),
    )
    await tx.execute(
      sql.raw(`alter role ${METRICS_ROLE} set statement_timeout = '${STATEMENT_TIMEOUT}'`),
    )
    await tx.execute(sql.raw(`grant pg_monitor to ${METRICS_ROLE}`))

    const [row] = await tx.execute<{ rolpassword: string | null }>(
      sql`select rolpassword from pg_authid where rolname = ${METRICS_ROLE}`,
    )
    if (isVerifierOf(row?.rolpassword ?? null, password)) return false
    // `ALTER ROLE` takes no parameter; the verifier is base64 and `$:` alone, checked by its shape.
    const verifier = scramVerifier(password)
    if (!VERIFIER.test(verifier)) throw new Error('a SCRAM verifier out of its shape')
    await tx.execute(sql.raw(`alter role ${METRICS_ROLE} password '${verifier}'`))
    return true
  })
  if (changed) {
    // With a timeout it waits for each to be gone, so the rotation is over when this returns.
    await db.execute(
      sql`select pg_terminate_backend(pid, 5000) from pg_stat_activity where usename = ${METRICS_ROLE}`,
    )
  }
  return changed
}
