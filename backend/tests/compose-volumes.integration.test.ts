import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { services } from './compose'

const dockerfile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

/** The owner a one-shot service of the compose file gives its volumes, as `uid:gid`. */
function ownerGiven(service: string): string | undefined {
  return /^ {4}entrypoint: \[chown, -R, '(\d+:\d+)',/m.exec(services().get(service) ?? '')?.[1]
}

/** The paths a one-shot service's `chown` walks. */
function pathsWalked(service: string): string[] {
  const line = /^ {4}entrypoint: \[chown, -R, '\d+:\d+', (.+)\]$/m.exec(
    services().get(service) ?? '',
  )
  return line?.[1]?.split(', ') ?? []
}

/** A service's named volumes, each by its name and where it is mounted. */
function volumesOf(service: string): Map<string, string> {
  const block = services().get(service) ?? ''
  const list = /^ {4}volumes:\n((?: {6}- .+\n)+)/m.exec(block)?.[1] ?? ''
  return new Map(
    [...list.matchAll(/^ {6}- ([a-z_]+):(\S+)$/gm)].map(([, name, path]) => [
      String(name),
      String(path),
    ]),
  )
}

/**
 * Caddy and VictoriaMetrics run as users since MOL-365, and their volumes, filled by root before, are
 * given to them by a one-shot service at every `up` of theirs. The service names the user by its
 * numbers — an image put back by a rollback has no `caddy` — so a number changed in a Dockerfile and
 * not here would leave the volume to somebody else, and Caddy refuses to start on it (adversarial В2).
 */
describe('docker-compose.prod.yml gives the volumes to the users of the images', () => {
  it("frontend-volumes: Caddy's volumes to the uid and gid frontend/Dockerfile makes `caddy` with", () => {
    const file = dockerfile('frontend/Dockerfile')
    const uid = /adduser [^\n]*-u (\d+)[^\n]* caddy\b/.exec(file)?.[1]
    const gid = /addgroup [^\n]*-g (\d+) caddy\b/.exec(file)?.[1]
    expect(uid).toBeDefined()
    expect(ownerGiven('frontend-volumes')).toBe(`${String(uid)}:${String(gid)}`)
    expect(file).toMatch(/^USER caddy$/m)
  })

  it('victoria-volumes: `vmdata` to the USER of deploy/victoria/Dockerfile', () => {
    const user = /^USER (\d+:\d+)$/m.exec(dockerfile('deploy/victoria/Dockerfile'))?.[1]
    expect(user).toBeDefined()
    expect(ownerGiven('victoria-volumes')).toBe(user)
  })

  it('each walks every volume its service mounts, and nothing else — a volume left out stays root (Р2-В1)', () => {
    for (const [owner, service] of [
      ['frontend-volumes', 'frontend'],
      ['victoria-volumes', 'victoria'],
    ] as const) {
      const mounted = volumesOf(owner)
      expect(mounted.size, owner).toBeGreaterThan(0)
      expect([...mounted.keys()].sort(), owner).toEqual([...volumesOf(service).keys()].sort())
      expect(pathsWalked(owner).sort(), owner).toEqual([...mounted.values()].sort())
    }
  })

  it('each runs as root on its service image, with no network and only the rights a chown needs', () => {
    const blocks = services()
    for (const [owner, service] of [
      ['frontend-volumes', 'frontend'],
      ['victoria-volumes', 'victoria'],
    ] as const) {
      const image = /^ {4}image: (.+)$/m.exec(blocks.get(service) ?? '')?.[1]
      const block = blocks.get(owner) ?? ''
      expect(block, owner).toContain(`    image: ${String(image)}\n`)
      expect(block, owner).toContain(`    user: '0'\n`)
      expect(block, owner).toContain('    network_mode: none\n')
      expect(block, owner).toContain('    cap_drop: [ALL]\n    cap_add: [CHOWN, DAC_READ_SEARCH]\n')
      expect(blocks.get(service), service).toMatch(
        new RegExp(`^ {6}${owner}:\\n {8}condition: service_completed_successfully$`, 'm'),
      )
    }
  })
})
