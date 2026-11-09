/**
 * The stack of the metrics as it is written (MOL-145): no port outside, a network with no way out,
 * Caddy never reaching the metrics, the alarms at the thresholds of Р-6 of MOL-149, and every figure
 * the dashboard and the alarms read one that something writes — a name renamed in the API turns a
 * test red rather than a panel quietly empty.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import type { Sql } from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { METRICS_ROLE, ensureMetricsRole } from '@/db/metrics-role'
import { metricsDbPasswordSchema, ownerTelegramIdSchema } from '@/env'
import { httpMetrics, processMetrics } from '@/metrics'
import { compose, services } from './compose'
import { connect, connectDrizzle, testDatabaseUrl } from './db'
import { onlyRow, sorted } from './rows'

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')
}

interface RuleData {
  readonly refId: string
  readonly model: {
    readonly expr?: string
    readonly conditions?: readonly { readonly evaluator: { type: string; params: number[] } }[]
  }
}
interface Rule {
  readonly uid: string
  readonly for: string
  readonly noDataState: string
  readonly execErrState: string
  readonly data: readonly RuleData[]
}
interface Panel {
  readonly targets?: readonly { readonly expr: string }[]
}

const rules = (
  JSON.parse(read('deploy/grafana/provisioning/alerting/rules.json')) as {
    groups: { rules: Rule[] }[]
  }
).groups.flatMap((group) => group.rules)
const dashboard = JSON.parse(read('deploy/grafana/dashboards/molvia.json')) as { panels: Panel[] }
const notify = read('deploy/grafana/provisioning/alerting/notify.json')

function ruleOf(uid: string): { expr: string; evaluator: string; threshold: number; rule: Rule } {
  const rule = rules.find((candidate) => candidate.uid === uid)
  if (rule === undefined) throw new Error(`no rule ${uid}`)
  const expr = rule.data.find((part) => part.refId === 'A')?.model.expr ?? ''
  const evaluator = rule.data.find((part) => part.refId === 'C')?.model.conditions?.[0]?.evaluator
  return {
    expr,
    evaluator: evaluator?.type ?? '',
    threshold: evaluator?.params[0] ?? Number.NaN,
    rule,
  }
}

/** The route the photo of a receipt is sent by — its time is the phone's network, not the API (Р-3). */
const PHOTO_ROUTE = '/receipts/:receiptId/parts/:part'

/**
 * A person's requests (adversarial А7): not a scanner's 404, not the watch's `/health`, not the bot's
 * minute polls — a background no person asked for diluted a person's 500s and slow answers.
 */
const PEOPLE = 'route!~"unmatched|/health|/internal/.*"'

describe('the compose file', () => {
  it('publishes no port but Caddy’s and Grafana’s on the loopback', () => {
    // Every entry under `ports:`, quoted any way or not at all (review №2): a test that read only
    // single quotes let `- 9090:9090` through. The long form is refused, so nothing hides in it.
    const published = [...services()].flatMap(([name, block]) =>
      [
        ...(/^ {4}ports:\n((?: {6}(?:#.*|- .*)\n)+)/m.exec(block)?.[1] ?? '').matchAll(
          /^ {6}- (.+)$/gm,
        ),
      ].map((match) => `${name} ${(match[1] ?? '').replace(/^(['"])(.*)\1$/, '$2')}`),
    )
    expect(compose).not.toMatch(/^ {6}- (?:target|published):/m)
    expect(published).toEqual([
      'frontend ${HTTP_PORT:-80}:80',
      'frontend ${HTTPS_PORT:-443}:443',
      'grafana 127.0.0.1:${GRAFANA_PORT:-3000}:3000',
    ])
  })

  it('keeps the metrics on a network with no way out, and Grafana on its own way out', () => {
    expect(compose).toMatch(/^ {2}metrics:\n {4}internal: true$/m)
    const networks = new Map(
      [...services()].map(([name, block]) => [name, /^ {4}networks: \[(.*)\]$/m.exec(block)?.[1]]),
    )
    for (const name of ['victoria', 'node-exporter', 'cadvisor', 'postgres-exporter'])
      expect(networks.get(name), name).toBe('metrics')
    // Not `default` (review №4): beside Caddy, the API, the bot and the receipt reader, which asks
    // nobody who calls.
    expect(networks.get('grafana')).toBe('alerts, metrics')
    expect(compose).toMatch(/^ {2}alerts: \{\}$/m)
    for (const [name, joined] of networks)
      if (name !== 'grafana') expect(joined ?? '', name).not.toContain('alerts')
    // Neither the exporters' host network nor a privileged container (Р-7, Р-8) — cAdvisor gets the
    // one capability it reads the OOM-killer with (review №1).
    expect(compose).not.toMatch(/network_mode: host|privileged: true/)
    expect(services().get('cadvisor')).toMatch(/^ {4}cap_add:\n {6}- SYSLOG$/m)
    // Docker 29's containers are containerd's: without its socket cAdvisor's docker factory fails
    // and the server shows the machine alone (production, 04.10.2026).
    expect(services().get('cadvisor')).toContain(
      '- /run/containerd/containerd.sock:/run/containerd/containerd.sock:ro',
    )
  })

  it('logs the exporter in as its own role, never as the database’s owner (MOL-366)', () => {
    const exporter = services().get('postgres-exporter') ?? ''
    expect(exporter).toMatch(new RegExp(`^ {6}DATA_SOURCE_USER: ${METRICS_ROLE}$`, 'm'))
    expect(exporter).toMatch(/^ {6}DATA_SOURCE_PASS: \$\{METRICS_DB_PASSWORD:\?/m)
    expect(exporter).not.toMatch(/POSTGRES_USER|POSTGRES_PASSWORD/)
    // The API gives the role the same line at its start; without it the exporter is never let in.
    expect(services().get('backend')).toMatch(
      /^ {6}METRICS_DB_PASSWORD: \$\{METRICS_DB_PASSWORD:\?/m,
    )
    // A restore closes the role's sessions by its name, a literal of the script (review №10): renamed, it
    // would close nothing and say nothing.
    expect(read('deploy/backup/restore.sh')).toContain(`usename = '${METRICS_ROLE}'`)
  })

  it('scrapes the API on the port the API is given, and not through Caddy', () => {
    const port = /^ {6}METRICS_PORT: (\d+)$/m.exec(services().get('backend') ?? '')?.[1]
    expect(port).toBe('9464')
    expect(read('deploy/victoria/scrape.yml')).toContain(`- targets: ['backend:${port ?? ''}']`)
  })

  it('gives every service of the metrics a limit of memory', () => {
    for (const name of ['victoria', 'node-exporter', 'cadvisor', 'postgres-exporter', 'grafana'])
      expect(services().get(name), name).toMatch(/^ {4}mem_limit: \d+m$/m)
  })

  it('switches off everything Grafana would call home with (Р-6)', () => {
    const grafana = services().get('grafana') ?? ''
    for (const setting of [
      "GF_ANALYTICS_REPORTING_ENABLED: 'false'",
      "GF_ANALYTICS_CHECK_FOR_UPDATES: 'false'",
      "GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES: 'false'",
      "GF_NEWS_NEWS_FEED_ENABLED: 'false'",
      "GF_SECURITY_DISABLE_GRAVATAR: 'true'",
      "GF_USERS_ALLOW_SIGN_UP: 'false'",
      "GF_AUTH_ANONYMOUS_ENABLED: 'false'",
      "GF_PLUGINS_PREINSTALL_DISABLED: 'true'",
      "GF_PLUGINS_PUBLIC_KEY_RETRIEVAL_DISABLED: 'true'",
      "GF_SNAPSHOTS_EXTERNAL_ENABLED: 'false'",
      "GF_ANALYTICS_FEEDBACK_LINKS_ENABLED: 'false'",
    ])
      expect(grafana).toContain(setting)
  })

  it('hands Grafana the alarms’ own bot, never the product’s token (В-3)', () => {
    const grafana = services().get('grafana') ?? ''
    expect(grafana).not.toContain('TELEGRAM_BOT_TOKEN')
    for (const name of [...notify.matchAll(/\$__env\{(\w+)\}/g)].map((match) => match[1] ?? ''))
      expect(grafana, name).toMatch(new RegExp(`^ {6}${name}: `, 'm'))
    // Whom it writes is put in by `start.sh` from the owner of the failures, never baked in.
    expect(read('deploy/grafana/start.sh')).toContain('OWNER_TELEGRAM_ID')
    expect(grafana).toMatch(/^ {6}OWNER_TELEGRAM_ID: /m)
    expect(notify).not.toMatch(/"chatid": "-?\d+"/)
  })

  it('reads the owner’s id by the API’s rule in Grafana’s start too (adversarial А5)', () => {
    // A line the API took and start.sh refused stopped Grafana — every alarm — while the API ran.
    for (const value of ['+123456789', '123456789.0', ' 123456789', '1.23456789e8', '-1', 'abc']) {
      expect(ownerTelegramIdSchema.safeParse(value).success, value).toBe(false)
      const start = spawnSync(
        'sh',
        [fileURLToPath(new URL('../../deploy/grafana/start.sh', import.meta.url))],
        {
          env: { PATH: process.env.PATH, OWNER_TELEGRAM_ID: value },
          encoding: 'utf8',
        },
      )
      expect([value, start.status, start.stderr]).toEqual([
        value,
        1,
        'OWNER_TELEGRAM_ID must be a Telegram id: the alarms have nobody to write to\n',
      ])
    }
    expect(ownerTelegramIdSchema.parse('123456789')).toBe(123456789)
    // The admin's password goes through stdin, never the arguments every user sees in `ps`, and a
    // refusal stops Grafana rather than leave the old password open (review №14, round 2, Б2).
    const script = read('deploy/grafana/start.sh')
    expect(script).toContain('admin reset-admin-password --password-from-stdin')
    expect(script).not.toMatch(/reset-admin-password\s+"\$/)
    // The same value passes start.sh's check: what stops it then is the image's file, absent here.
    const start = spawnSync(
      'sh',
      [fileURLToPath(new URL('../../deploy/grafana/start.sh', import.meta.url))],
      {
        env: { PATH: process.env.PATH, OWNER_TELEGRAM_ID: '123456789' },
        encoding: 'utf8',
      },
    )
    expect(start.stderr).not.toContain('must be a Telegram id')
  })

  it('pulls the metrics before anything changes but lets only the application judge a rollout (adversarial А4)', () => {
    const deploy = read('deploy/deploy.sh')
    expect(deploy).toContain('metrics=(victoria node-exporter cadvisor postgres-exporter grafana)')
    expect(deploy).toMatch(/pull -q "\$\{metrics\[@\]\}" \|\|/)
    expect(deploy).toContain(
      'if "${compose[@]}" up -d postgres backend bot frontend receipt-reader && wait_healthy "$tag"; then',
    )
    expect(deploy).toMatch(/up -d "\$\{metrics\[@\]\}" \|\|/)
    // The list is the compose file's own services of the metrics.
    for (const name of ['victoria', 'node-exporter', 'cadvisor', 'postgres-exporter', 'grafana'])
      expect(services().has(name), name).toBe(true)
    expect(deploy).not.toMatch(/if "\$\{compose\[@\]\}" up -d && /)
  })
})

/**
 * The exporter's role on a real Postgres (MOL-366): the counters the dashboard draws, and nothing of
 * a person. The role is the cluster's, so this file is the one that touches it.
 */
describe('the exporter’s role', () => {
  const admin = connect()
  const { db, close } = connectDrizzle()
  const opened: Sql[] = []

  function password(): string {
    return randomBytes(24).toString('hex')
  }

  function asRole(secret: string, database?: string): Sql {
    const url = new URL(testDatabaseUrl())
    if (database !== undefined) url.pathname = `/${database}`
    url.username = METRICS_ROLE
    url.password = secret
    const client = postgres(url.toString(), {
      max: 1,
      connect_timeout: 5,
      onnotice: () => undefined,
    })
    opened.push(client)
    return client
  }

  /** The session's own process, the one a termination names. */
  async function backendPid(client: Sql): Promise<number> {
    const row = onlyRow(await client<{ pid: number }[]>`select pg_backend_pid() as pid`)
    if (row === undefined) throw new Error('no backend pid read')
    return row.pid
  }

  async function memberships(): Promise<string[]> {
    const rows = await admin<{ name: string }[]>`
      select granted.rolname as name
      from pg_auth_members m
      join pg_roles granted on granted.oid = m.roleid
      join pg_roles member on member.oid = m.member
      where member.rolname = ${METRICS_ROLE}`
    return sorted(rows.map((row) => row.name))
  }

  async function storedVerifier(): Promise<string | null> {
    const row = onlyRow(
      await admin<{ rolpassword: string | null }[]>`
        select rolpassword from pg_authid where rolname = ${METRICS_ROLE}`,
    )
    return row?.rolpassword ?? null
  }

  afterAll(async () => {
    await Promise.all(opened.map((client) => client.end({ timeout: 1 }).catch(() => undefined)))
    await admin.end()
    await close()
  })

  it('reads what the panel «Postgres» draws, another session’s state too', async () => {
    const secret = password()
    await ensureMetricsRole(db, secret)
    const role = asRole(secret)
    const pid = await backendPid(admin)
    // Without `pg_read_all_stats` another role's session shows no state, and the panel of
    // connections by state would count them all as null.
    const seen = onlyRow(
      await role<{ state: string | null }[]>`select state from pg_stat_activity where pid = ${pid}`,
    )
    expect(seen?.state).toBe('idle')
    const figures = onlyRow(
      await role<{ max: string; size: string; deadlocks: string | null }[]>`
        select (select setting from pg_settings where name = 'max_connections') as max,
               pg_database_size(current_database())::text as size,
               (select deadlocks::text from pg_stat_database where datname = current_database())
                 as deadlocks`,
    )
    expect(Number(figures?.max)).toBeGreaterThan(0)
    expect(Number(figures?.size)).toBeGreaterThan(0)
    expect(figures?.deadlocks).not.toBeNull()
    expect(
      onlyRow(await role<{ statement_timeout: string }[]>`show statement_timeout`)
        ?.statement_timeout,
    ).toBe('5s')
  })

  it('reads no table and writes none', async () => {
    const secret = password()
    await ensureMetricsRole(db, secret)
    const role = asRole(secret)
    await expect(role`select count(*) from actors`).rejects.toMatchObject({ code: '42501' })
    await expect(role`delete from actors`).rejects.toMatchObject({ code: '42501' })
    // Not one table, view or sequence of ours — drizzle's journal included.
    const granted = await admin<{ name: string }[]>`
      select n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
        and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
        and has_table_privilege(${METRICS_ROLE}, c.oid,
          'select, insert, update, delete, truncate, references, trigger')`
    expect(granted).toEqual([])
    const [schema] = await admin<{ create: boolean }[]>`
      select has_schema_privilege(${METRICS_ROLE}, 'public', 'create') as create`
    expect(schema?.create).toBe(false)
  })

  it('holds no power over the cluster, pg_monitor its one membership (В-3 «а»)', async () => {
    await ensureMetricsRole(db, password())
    const roles = await admin`
      select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit,
             rolcanlogin, rolconnlimit, rolconfig
      from pg_roles where rolname = ${METRICS_ROLE}`
    expect(roles).toEqual([
      {
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolinherit: true,
        rolcanlogin: true,
        rolconnlimit: 3,
        rolconfig: ['statement_timeout=5s', 'temp_file_limit=64MB'],
      },
    ])
    expect(await memberships()).toEqual(['pg_monitor'])
  })

  it('brings a role changed by hand, or by itself, back to its form (adversarial А2б, А4)', async () => {
    const secret = password()
    await ensureMetricsRole(db, secret)
    const database = new URL(testDatabaseUrl()).pathname.slice(1)
    // A role may give itself a setting for one database, which stands above its own for all.
    await asRole(secret).unsafe(
      `alter role ${METRICS_ROLE} in database ${database} set statement_timeout = 0`,
    )
    // The connection limit is set by the same statement as these, and held at 3 above.
    await admin.unsafe(`alter role ${METRICS_ROLE} superuser createdb valid until '2000-01-01'`)
    await admin.unsafe(`alter role ${METRICS_ROLE} reset statement_timeout`)
    await admin.unsafe(`grant pg_read_all_data to ${METRICS_ROLE}`)
    // The same password: nothing to rotate, and the form comes back all the same.
    expect(await ensureMetricsRole(db, secret)).toBe(false)
    const role = onlyRow(
      await admin`
        select rolsuper, rolcreatedb, rolconnlimit, rolconfig, rolvaliduntil::text as term
        from pg_roles
        where rolname = ${METRICS_ROLE}`,
    )
    expect(role).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolconnlimit: 3,
      rolconfig: ['statement_timeout=5s', 'temp_file_limit=64MB'],
      term: 'infinity',
    })
    expect(await memberships()).toEqual(['pg_monitor'])
    // The exporter logs in again — its term past refused it — with no limit lifted for this database.
    const exporter = asRole(secret)
    expect(
      onlyRow(await exporter<{ statement_timeout: string }[]>`show statement_timeout`)
        ?.statement_timeout,
    ).toBe('5s')
  })

  it('takes no advisory lock, which the API waits on with no term (adversarial А1)', async () => {
    const secret = password()
    await ensureMetricsRole(db, secret)
    const role = asRole(secret)
    // The login's quota and a person's writes wait on such keys, strings of a public repository.
    await expect(
      role`select pg_advisory_lock(hashtextextended('molvia:login-quota', 0))`,
    ).rejects.toMatchObject({ code: '42501' })
    await expect(role`select pg_try_advisory_xact_lock(1, 2)`).rejects.toMatchObject({
      code: '42501',
    })
    await expect(role`select pg_advisory_lock_shared(1)`).rejects.toMatchObject({ code: '42501' })
  })

  it('writes no disk of its own: no temporary table, no other database (owner’s В-4 «б»)', async () => {
    const secret = password()
    await ensureMetricsRole(db, secret)
    const role = asRole(secret)
    await expect(role`create temp table fill (g int)`).rejects.toMatchObject({ code: '42501' })
    // Its sorts and hashes have a limit only a superuser lifts — unlike the five seconds (А2).
    expect(
      onlyRow(await role<{ temp_file_limit: string }[]>`show temp_file_limit`)?.temp_file_limit,
    ).toBe('64MB')
    await expect(role`set temp_file_limit = -1`).rejects.toMatchObject({ code: '42501' })
    // Nor `postgres`, where a temporary table would be the cluster's disk all the same.
    await expect(asRole(secret, 'postgres')`select 1`).rejects.toMatchObject({ code: '42501' })
    // A database the role was let into by a start there is closed by a start in another (the cluster
    // of the tests holds a database for each worker), and the one it starts in opened again.
    const database = new URL(testDatabaseUrl()).pathname.slice(1)
    await admin.unsafe(`grant connect on database postgres to ${METRICS_ROLE}`)
    await admin.unsafe(`revoke connect on database ${database} from public, ${METRICS_ROLE}`)
    await ensureMetricsRole(db, secret)
    await expect(asRole(secret)`select 1 as one`).resolves.toEqual([{ one: 1 }])
    await expect(asRole(secret, 'postgres')`select 1`).rejects.toMatchObject({ code: '42501' })
  })

  it('rotates past a session of the role holding its own row (adversarial А3)', async () => {
    const leaked = password()
    await ensureMetricsRole(db, leaked)
    // A role may change its own password; in an open transaction its row of pg_authid is held.
    const holder = await asRole(leaked).reserve()
    await holder`begin`
    await holder.unsafe(`alter role ${METRICS_ROLE} password 'the-leaked-session-holds-it'`)
    const pid = await backendPid(holder)
    const fresh = password()
    expect(await ensureMetricsRole(db, fresh)).toBe(true)
    expect(await admin`select 1 from pg_stat_activity where pid = ${pid}`).toEqual([])
    await expect(asRole(leaked)`select 1`).rejects.toMatchObject({ code: '28P01' })
    await expect(asRole(fresh)`select 1 as one`).resolves.toEqual([{ one: 1 }])
  })

  it('takes two starts at once, made or not, one after the other (adversarial А5)', async () => {
    const one = connectDrizzle()
    const two = connectDrizzle()
    try {
      await admin`select pg_terminate_backend(pid, 5000) from pg_stat_activity where usename = ${METRICS_ROLE}`
      // Its grant on the database is its own: `drop owned` takes it, a bare `drop role` is refused.
      await admin.unsafe(`drop owned by ${METRICS_ROLE}`)
      await admin.unsafe(`drop role ${METRICS_ROLE}`)
      for (let round = 0; round < 2; round++) {
        const results = await Promise.allSettled([
          ensureMetricsRole(one.db, password()),
          ensureMetricsRole(two.db, password()),
        ])
        expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
      }
    } finally {
      await one.close()
      await two.close()
    }
  })

  it('writes nothing and closes nothing when started again with the same password (Р-2)', async () => {
    const secret = password()
    await ensureMetricsRole(db, secret)
    const stored = await storedVerifier()
    const role = asRole(secret)
    const before = await backendPid(role)
    expect(await ensureMetricsRole(db, secret)).toBe(false)
    expect(await storedVerifier()).toBe(stored)
    expect(await backendPid(role)).toBe(before)
  })

  it('takes a new password, refuses the old one and closes what it opened (Р-2)', async () => {
    const old = password()
    await ensureMetricsRole(db, old)
    const role = asRole(old)
    const held = await backendPid(role)
    const fresh = password()
    expect(await ensureMetricsRole(db, fresh)).toBe(true)
    // Gone when the call returns: the termination waits for it.
    const left = await admin`select 1 from pg_stat_activity where pid = ${held}`
    expect(left).toEqual([])
    // A leaked password neither keeps its session nor opens a new one.
    await expect(asRole(old)`select 1`).rejects.toMatchObject({ code: '28P01' })
    await expect(asRole(fresh)`select 1 as one`).resolves.toEqual([{ one: 1 }])
  })

  it('takes a password SASLprep leaves as it is, nothing shorter than 24', () => {
    for (const secret of [password(), 'A!b#c$d%e&f(g)h*i+j,k-l.m/n:o;p<q=r>s?t@u[v]w^x_y`z{|}~'])
      expect(metricsDbPasswordSchema.safeParse(secret).success, secret).toBe(true)
    for (const secret of [
      'a'.repeat(23),
      `${'a'.repeat(24)} `,
      `${'a'.repeat(24)}\t`,
      'пароль'.repeat(5),
    ])
      expect(metricsDbPasswordSchema.safeParse(secret).success, secret).toBe(false)
  })
})

describe('Caddy', () => {
  it('proxies to the API’s port alone, so the metrics’ is out of its reach', () => {
    const proxied = [...read('deploy/Caddyfile').matchAll(/reverse_proxy\s+(\S+)/g)].map(
      (match) => match[1],
    )
    expect(proxied).toEqual(['backend:3300'])
  })
})

describe('the alarms', () => {
  it('stand at the thresholds of Р-6 of MOL-149', () => {
    const memory = ruleOf('molvia-memory')
    expect([memory.evaluator, memory.threshold, memory.rule.for]).toEqual(['gt', 0.85, '5m'])

    const disk = ruleOf('molvia-disk')
    expect([disk.evaluator, disk.threshold]).toEqual(['gt', 0.8])
    expect(disk.expr).toContain('mountpoint="/"')

    const errors = ruleOf('molvia-5xx')
    expect([errors.evaluator, errors.threshold]).toEqual(['gt', 0.05])
    expect(errors.expr).toContain('[5m]')
    expect(errors.expr).toContain('>= 20')
    // The share, its denominator and the twenty are all a person's requests (adversarial А7).
    expect(errors.expr.match(/molvia_http_requests_total\{[^}]*\}/g)).toEqual([
      `molvia_http_requests_total{${PEOPLE},status="5xx"}`,
      `molvia_http_requests_total{${PEOPLE}}`,
      `molvia_http_requests_total{${PEOPLE}}`,
    ])

    const slow = ruleOf('molvia-p95')
    expect([slow.evaluator, slow.threshold, slow.rule.for]).toEqual(['gt', 1, '15m'])
    expect(slow.expr).toContain('histogram_quantile(0.95,')
    expect(slow.expr).toContain('>= 20')

    const restart = ruleOf('molvia-restart')
    expect([restart.evaluator, restart.threshold]).toEqual(['gt', 0])
    expect(restart.expr).toContain('resets(container_cpu_usage_seconds_total')
    // VictoriaMetrics counts a series' first sample as a change: a rollout's new container would
    // be «restarted». A reset of the CPU counter of the same container is not.
    expect(restart.expr).not.toMatch(/\bchanges\(/)
  })

  it('say when cAdvisor sees no container — a blind restart alarm is silence', () => {
    const blind = ruleOf('molvia-containers')
    expect([blind.expr, blind.evaluator, blind.threshold, blind.rule.for]).toEqual([
      'absent(container_cpu_usage_seconds_total{container_label_com_docker_compose_service="backend"}) or on() vector(0)',
      'gt',
      0,
      '5m',
    ])
  })

  it('read p95 of a person’s requests, the photo of a receipt left out by a route the API still has', () => {
    const slow = `route!~"unmatched|/health|/internal/.*|${PHOTO_ROUTE}"`
    expect(ruleOf('molvia-p95').expr.match(/molvia_http_\w+\{[^}]*\}/g)).toEqual([
      `molvia_http_request_duration_seconds_bucket{${slow}}`,
      `molvia_http_requests_total{${slow}}`,
    ])
    expect(read('backend/src/routes/receipts.ts')).toContain(`'${PHOTO_ROUTE}'`)
  })

  it('speak when the figures stop, as when they cross (Р-5)', () => {
    for (const rule of rules.filter((candidate) => candidate.uid !== 'molvia-pulse')) {
      expect([rule.uid, rule.noDataState, rule.execErrState]).toEqual([
        rule.uid,
        'Alerting',
        'Alerting',
      ])
    }
    const silent = ruleOf('molvia-targets')
    expect([silent.expr, silent.evaluator, silent.threshold]).toEqual([
      'min by (job) (up)',
      'lt',
      1,
    ])
  })
})

/**
 * Every alarm ever shipped, by its uid (adversarial А6 а). Provisioning never deletes a rule by itself:
 * one taken out of `rules.json` kept alarming from `grafana_data`, with nothing in the repository to find
 * it by. So a uid that leaves the groups goes to `deleteRules` of the same file, and a new one joins this
 * list — never leaves it.
 */
const SHIPPED_RULES = [
  'molvia-memory',
  'molvia-disk',
  'molvia-5xx',
  'molvia-p95',
  'molvia-restart',
  'molvia-targets',
  'molvia-pulse',
  'molvia-containers',
]

describe('a rule removed (adversarial А6 а)', () => {
  it('is deleted in Grafana by the same file, never left alarming from its volume', () => {
    const file = JSON.parse(read('deploy/grafana/provisioning/alerting/rules.json')) as {
      deleteRules?: { orgId: number; uid: string }[]
    }
    const deleted = (file.deleteRules ?? []).map((rule) => rule.uid)
    const shipped = rules.map((rule) => rule.uid)
    expect(shipped.filter((uid) => !SHIPPED_RULES.includes(uid))).toEqual([])
    expect(SHIPPED_RULES.filter((uid) => !shipped.includes(uid) && !deleted.includes(uid))).toEqual(
      [],
    )
    expect(deleted.filter((uid) => shipped.includes(uid))).toEqual([])
  })
})

describe('the pulse of the alarms (adversarial А5)', () => {
  it('fires while Grafana counts and VictoriaMetrics answers, and goes nowhere but its ping', () => {
    const pulse = ruleOf('molvia-pulse')
    expect([pulse.evaluator, pulse.threshold]).toEqual(['gt', 0])
    // VictoriaMetrics answers and reads Grafana's own figures — without them a failed delivery is
    // nothing to read, and the pulse went on.
    expect(
      pulse.expr.startsWith(
        '(min(up{job="victoria"}) and on() (min(up{job="grafana"}) > 0)) unless on() ',
      ),
    ).toBe(true)
    // And not while an alarm failed on its way to Telegram with none delivered beside it (round 2,
    // Б1): a revoked token or a bot never started left every alarm undelivered and the pulse green.
    const failed = 'grafana_alerting_notifications_failed_total{integration="telegram"}'
    const tried = 'grafana_alerting_notifications_total{integration="telegram"}'
    expect(pulse.expr).toContain(`(sum(increase(${failed}[1h])) > 0) unless on()`)
    expect(pulse.expr).toContain(
      `((sum(increase(${tried}[1h])) - sum(increase(${failed}[1h]))) > 0)`,
    )
    expect(read('deploy/victoria/scrape.yml')).toContain("- targets: ['grafana:3000']")
    // VictoriaMetrics down or no figure is the pulse stopping — the silence healthchecks.io tells of.
    expect([pulse.rule.noDataState, pulse.rule.execErrState]).toEqual(['OK', 'OK'])

    const config = JSON.parse(notify) as {
      contactPoints: {
        name: string
        receivers: { type: string; settings: { url?: string }; disableResolveMessage: boolean }[]
      }[]
      policies: {
        receiver: string
        routes?: {
          receiver: string
          object_matchers: string[][]
          repeat_interval: string
          continue: boolean
        }[]
      }[]
    }
    const point = config.contactPoints.find((candidate) => candidate.name === 'pulse')
    // A resolved message would ping «alive» the moment the pulse stops.
    expect(point?.receivers).toEqual([
      expect.objectContaining({
        type: 'webhook',
        settings: expect.objectContaining({ url: '$__env{ALERTS_PULSE_URL}' }) as unknown,
        disableResolveMessage: true,
      }),
    ])
    expect(config.policies[0]?.routes).toEqual([
      expect.objectContaining({
        receiver: 'pulse',
        object_matchers: [['pulse', '=', 'true']],
        repeat_interval: '5m',
        continue: false,
      }),
    ])
    expect(services().get('grafana')).toMatch(/^ {6}ALERTS_PULSE_URL: \$\{ALERTS_PULSE_URL:\?/m)
  })
})

describe('the dashboard', () => {
  it('shows the longest late tick of the loop — a block of seconds is one tick, never in p99 (review №13)', () => {
    const exprs = dashboard.panels.flatMap((panel) =>
      (panel.targets ?? []).map((target) => target.expr),
    )
    expect(exprs).toContain('nodejs_eventloop_lag_max_seconds{job="api"}')
  })

  it('reads the API’s process figures by its job — the exporters write the same names', () => {
    const exprs = dashboard.panels.flatMap((panel) =>
      (panel.targets ?? []).map((target) => target.expr),
    )
    const unscoped = exprs.filter((expr) =>
      /\b(?:process|nodejs)_\w+\b(?!\{job="api"\})/.test(expr),
    )
    expect(unscoped).toEqual([])
  })
})

describe('every figure read', () => {
  /** What the exporters write, by the names their versions in the compose file export. */
  const EXPORTED = new Set([
    'up',
    'node_memory_MemAvailable_bytes',
    'node_memory_MemTotal_bytes',
    'node_filesystem_avail_bytes',
    'node_filesystem_size_bytes',
    'node_cpu_seconds_total',
    'node_load1',
    'node_load15',
    'container_memory_working_set_bytes',
    'container_cpu_usage_seconds_total',
    'container_spec_memory_limit_bytes',
    'container_oom_events_total',
    'pg_stat_activity_count',
    'pg_settings_max_connections',
    'pg_database_size_bytes',
    'pg_long_running_transactions_oldest_timestamp_seconds',
    'pg_stat_database_deadlocks',
    'pg_stat_database_xact_rollback',
    'grafana_alerting_notifications_total',
    'grafana_alerting_notifications_failed_total',
  ])

  const running = processMetrics()
  afterAll(() => {
    running.stop()
  })

  it('is written by the API or an exporter', () => {
    const http = httpMetrics()
    http.observe('GET', '/health', 200, 0.01)
    const written = new Set(
      `${http.render()}${running.render()}`
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => /^[a-zA-Z_:][\w:]*/.exec(line)?.[0] ?? ''),
    )

    const exprs = [
      ...rules.flatMap((rule) => rule.data.map((part) => part.model.expr ?? '')),
      ...dashboard.panels.flatMap((panel) => (panel.targets ?? []).map((target) => target.expr)),
    ]
    const names = new Set(
      exprs.flatMap((expr) =>
        [...expr.matchAll(/\b(?:molvia|nodejs|process|node|container|pg|grafana)_\w+|\bup\b/g)].map(
          (match) => match[0],
        ),
      ),
    )
    // A label cAdvisor makes of the compose service, not a figure.
    names.delete('container_label_com_docker_compose_service')
    expect([...names].filter((name) => !written.has(name) && !EXPORTED.has(name))).toEqual([])
    expect(names.size).toBeGreaterThan(20)
  })
})
