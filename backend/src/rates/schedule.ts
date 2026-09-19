/** Once an hour: the central bank publishes once a working day, and it is someone else's server. */
export const REFRESH_EVERY_MS = 60 * 60 * 1000

/**
 * Whether the boot should refresh at once: not when the cache was written less than a period
 * ago. `make dev` restarts the API on every saved file, and each restart asking the central bank
 * made dozens of calls an hour from every working copy (MOL-39, С-1). In development, not at all
 * once the cache holds anything (Р-26): with the sources unreachable nothing is written, «less
 * than a period ago» never comes true, and every save went to all three. Production boots rarely,
 * and a deploy an hour after the last refresh still refreshes at once.
 */
export function refreshAtBoot(
  lastFetchedAt: Date | null,
  now: Date,
  { development = false, everyMs = REFRESH_EVERY_MS } = {},
): boolean {
  if (lastFetchedAt === null) return true
  if (development) return false
  return now.getTime() - lastFetchedAt.getTime() >= everyMs
}

/**
 * Runs the refresh — at once if `immediately`, and then every `everyMs` — in the API's own
 * process: there is one instance (CLAUDE.md, «Deployment»), so no second timer fights it for the
 * same row. A run that is still going when the next is due is not doubled. Unreferenced, so the
 * timer never keeps a process alive that is otherwise done; the returned function stops it.
 */
export function startSchedule(
  run: () => Promise<void>,
  { everyMs = REFRESH_EVERY_MS, immediately = true } = {},
): () => void {
  let running = false
  const tick = (): void => {
    if (running) return
    running = true
    void run().finally(() => {
      running = false
    })
  }
  if (immediately) tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}
