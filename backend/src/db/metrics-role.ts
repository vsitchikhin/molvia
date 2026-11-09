import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Conn, Db } from '@/db'

/** The role postgres_exporter logs in as (MOL-366): counters and nothing of a person. */
export const METRICS_ROLE = 'molvia_metrics'

/** What a role so bounded still holds (В-3 «а»): enough for one exporter, not for the API's hundred. */
const CONNECTION_LIMIT = 3
const STATEMENT_TIMEOUT = '5s'
/**
 * The disk its sorts and hashes may write (owner's В-4 «б»): a setting only a superuser sets, so no
 * session of the role lifts it as it lifts its five seconds. The exporter's queries write none.
 */
const TEMP_FILE_LIMIT = '64MB'

/** How long a start waits on a lock the role may hold (adversarial А3): then it fails, and the owner hears. */
const LOCK_TIMEOUT = '5s'

const ITERATIONS = 4096
const VERIFIER = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/

/**
 * The password as Postgres stores it, counted here as `psql \password` counts it (Р-1): the
 * statement carries the verifier, never the password, which a failed `ALTER ROLE` would write
 * into Postgres's log. A verifier alone opens nothing. The password is printable ASCII
 * (`metricsDbPasswordSchema`), which SASLprep leaves as it is, so libpq on the exporter's side counts
 * the same keys.
 */
function scramVerifier(
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

async function storedVerifier(db: Conn): Promise<string | null> {
  const [row] = await db.execute<{ rolpassword: string | null }>(
    sql`select rolpassword from pg_authid where rolname = ${METRICS_ROLE}`,
  )
  return row?.rolpassword ?? null
}

/**
 * Every session of the role closed, waiting up to five seconds for each; one still there is a failure
 * (review №1) — the rotation promised it gone, and nothing at the next start would look again.
 */
async function closeSessions(db: Db): Promise<void> {
  const [row] = await db.execute<{ left: number }>(sql`
    select count(*) filter (where not pg_terminate_backend(pid, 5000))::int as left
    from pg_stat_activity where usename = ${METRICS_ROLE}`)
  if ((row?.left ?? 0) > 0)
    throw new Error(`${String(row?.left)} sessions of the metrics role outlived the rotation`)
}

/**
 * The exporter's role brought to its form at every start of the API (MOL-366, В-1 «а»), never by a
 * migration: a role is the cluster's, a migration runs in each of its databases, and `pg_dump`
 * carries no role — a machine restored from a copy would have none behind a journal that says
 * everything ran.
 *
 * Its form: made if missing; its attributes, its term (`valid until`, adversarial А4б) and its own
 * settings set again — those it may give itself for one database too (А2б); `pg_monitor` its one
 * membership (А4). Grants on objects are not looked at: nothing grants any. **And the advisory locks
 * of this database are not the role's** (А1): `PUBLIC` may take them, the API waits on them with no
 * term, and their keys are strings of a public repository — held by the role, one key closed the
 * login for everybody and ten waiting took the API's pool. The API, a superuser, keeps them. **Nor
 * the disk** (owner's В-4 «б», adversarial А2в): no temporary table in any database of the cluster, no
 * database but the API's to log in to, and a limit on its temporary files. Its five seconds a statement
 * are the exporter's default, never a bound — any session lifts them (А2), and the CPU and the memory of
 * its three connections are a price.
 *
 * Its password is written only when another (Р-2). Then the role's sessions are closed before — one
 * holding its row in an open transaction would leave the start waiting (А3) — and after, and the
 * stored verifier read again: a session may change its own password between the commit and its end.
 * A lock the role holds is waited on five seconds at most, then a failure the owner hears (В-2 «а»).
 * One start at a time in a database (А5): two at once raced to the same row.
 * Returns whether the password changed.
 */
export async function ensureMetricsRole(db: Db, password: string): Promise<boolean> {
  if (!isVerifierOf(await storedVerifier(db), password)) await closeSessions(db)
  const changed = await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`))
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('molvia:metrics-role'))`)
    // Two databases of one cluster, one after the other: «already there» is the answer, not a failure.
    await tx.execute(
      sql.raw(`do $$ begin create role ${METRICS_ROLE} login;
        exception when duplicate_object or unique_violation then null; end $$`),
    )
    await tx.execute(
      sql.raw(`alter role ${METRICS_ROLE} login inherit nosuperuser nocreatedb nocreaterole
        noreplication nobypassrls connection limit ${String(CONNECTION_LIMIT)}
        valid until 'infinity'`),
    )
    await tx.execute(sql.raw(`alter role ${METRICS_ROLE} reset all`))
    await tx.execute(
      sql.raw(`do $$ declare d name; begin
        for d in select db.datname from pg_db_role_setting s join pg_database db on db.oid = s.setdatabase
          where s.setrole = '${METRICS_ROLE}'::regrole loop
          execute format('alter role ${METRICS_ROLE} in database %I reset all', d);
        end loop; end $$`),
    )
    await tx.execute(
      sql.raw(`alter role ${METRICS_ROLE} set statement_timeout = '${STATEMENT_TIMEOUT}'`),
    )
    await tx.execute(
      sql.raw(`alter role ${METRICS_ROLE} set temp_file_limit = '${TEMP_FILE_LIMIT}'`),
    )
    await tx.execute(
      sql.raw(`do $$ declare r name; begin
        for r in select granted.rolname from pg_auth_members m join pg_roles granted on granted.oid = m.roleid
          where m.member = '${METRICS_ROLE}'::regrole and granted.rolname <> 'pg_monitor' loop
          execute format('revoke %I from ${METRICS_ROLE}', r);
        end loop; end $$`),
    )
    await tx.execute(sql.raw(`grant pg_monitor to ${METRICS_ROLE}`))
    await tx.execute(
      sql.raw(`do $$ declare f regprocedure; begin
        for f in select p.oid::regprocedure from pg_proc p
          where p.pronamespace = 'pg_catalog'::regnamespace
            and p.proname ~ '^pg_(try_)?advisory_(xact_)?lock(_shared)?$' loop
          execute format('revoke execute on function %s from public', f);
        end loop; end $$`),
    )
    // No temporary table anywhere in the cluster, and no database but this one to log in to (В-4 «б»):
    // a table of its own had no limit, and `postgres` or `template1` would take one all the same. The
    // role's own grant too — given by a start in another database of the cluster, as the tests' are.
    await tx.execute(
      sql.raw(`do $$ declare d name; begin
        for d in select datname from pg_database where datallowconn loop
          if d = current_database() then
            execute format('revoke temporary on database %I from public, ${METRICS_ROLE}', d);
            execute format('grant connect on database %I to ${METRICS_ROLE}', d);
          else
            execute format('revoke connect, temporary on database %I from public, ${METRICS_ROLE}', d);
          end if;
        end loop; end $$`),
    )

    if (isVerifierOf(await storedVerifier(tx), password)) return false
    // `ALTER ROLE` takes no parameter; the verifier is base64 and `$:` alone, checked by its shape.
    const verifier = scramVerifier(password)
    if (!VERIFIER.test(verifier)) throw new Error('a SCRAM verifier out of its shape')
    await tx.execute(sql.raw(`alter role ${METRICS_ROLE} password '${verifier}'`))
    return true
  })
  if (changed) {
    await closeSessions(db)
    if (!isVerifierOf(await storedVerifier(db), password))
      throw new Error('the metrics role changed its password during the rotation')
  }
  return changed
}
