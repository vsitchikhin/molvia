/**
 * The stack of the metrics as it is written (MOL-145): no port outside, a network with no way out,
 * Caddy never reaching the metrics, the alarms at the thresholds of Р-6 of MOL-149, and every figure
 * the dashboard and the alarms read one that something writes — a name renamed in the API turns a
 * test red rather than a panel quietly empty.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { httpMetrics, processMetrics } from '@/metrics'
import { compose, services } from './compose'

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

describe('the compose file', () => {
  it('publishes no port but Caddy’s and Grafana’s on the loopback', () => {
    const published = [...services()].flatMap(([name, block]) =>
      [
        ...(/^ {4}ports:\n((?: {6}(?:#.*|- .*)\n)+)/m.exec(block)?.[1] ?? '').matchAll(
          /^ {6}- '([^']+)'$/gm,
        ),
      ].map((match) => `${name} ${match[1] ?? ''}`),
    )
    expect(published).toEqual([
      'frontend ${HTTP_PORT:-80}:80',
      'frontend ${HTTPS_PORT:-443}:443',
      'grafana 127.0.0.1:${GRAFANA_PORT:-3000}:3000',
    ])
  })

  it('keeps the metrics on a network with no way out, and Grafana alone in both', () => {
    expect(compose).toMatch(/^ {2}metrics:\n {4}internal: true$/m)
    const networks = new Map(
      [...services()].map(([name, block]) => [name, /^ {4}networks: \[(.*)\]$/m.exec(block)?.[1]]),
    )
    for (const name of ['victoria', 'node-exporter', 'cadvisor', 'postgres-exporter'])
      expect(networks.get(name), name).toBe('metrics')
    expect(networks.get('grafana')).toBe('default, metrics')
    // Neither the exporters' host network nor a privileged container (Р-7, Р-8).
    expect(compose).not.toMatch(/network_mode: host|privileged: true/)
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

  it('leave the photo of a receipt out of p95 by a route the API still has', () => {
    expect(ruleOf('molvia-p95').expr).toContain(`route!="${PHOTO_ROUTE}"`)
    expect(read('backend/src/routes/receipts.ts')).toContain(`'${PHOTO_ROUTE}'`)
  })

  it('speak when the figures stop, as when they cross (Р-5)', () => {
    for (const rule of rules) {
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

describe('the dashboard', () => {
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
        [...expr.matchAll(/\b(?:molvia|nodejs|process|node|container|pg)_\w+|\bup\b/g)].map(
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
