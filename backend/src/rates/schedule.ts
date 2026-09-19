/** Once an hour: the central bank publishes once a working day, and it is someone else's server. */
export const REFRESH_EVERY_MS = 60 * 60 * 1000

/**
 * Runs the refresh now and then every `everyMs`, in the API's own process — there is one
 * instance (CLAUDE.md, «Deployment»), so no second timer fights it for the same row. A run that
 * is still going when the next is due is not doubled. Unreferenced, so the timer never keeps a
 * process alive that is otherwise done; the returned function stops it.
 */
export function startSchedule(run: () => Promise<void>, everyMs = REFRESH_EVERY_MS): () => void {
  let running = false
  const tick = (): void => {
    if (running) return
    running = true
    void run().finally(() => {
      running = false
    })
  }
  tick()
  const timer = setInterval(tick, everyMs)
  timer.unref()
  return () => {
    clearInterval(timer)
  }
}
