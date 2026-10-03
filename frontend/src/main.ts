import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { applyDocumentLang, i18n } from '@/i18n'
import { settleColdStart } from '@/navigation'
import { router } from '@/router'
import { installArrival, installHeightHold, installViewTransitions } from '@/transitions'
import { installSheetEntryGuard } from '@/composables/useSheetHistory'
import { installColorScheme } from '@/composables/useColorScheme'
import { sessionEnded, useActorStore } from '@/stores/actor'
import { forgetTheInviteDoor } from '@/stores/identity'
import { api, onMissingActor, onServerVersion } from '@/api'
import { installFailureReports, pageBuild } from '@/failures'
import { platformLine } from '@/platform'
import { useLoginStore } from '@/stores/login'
import { forget, read, writeOwn } from '@/stores/storage'
import { NO_UPDATE, holdsTyping, installPwaUpdate, pwaUpdateKey } from '@/pwaUpdate'
import '@/styles/main.scss'

// The phone's own failures go to the API's table (MOL-144), and the catchers stand first, before any
// step of the start (adversarial А4): a white screen at the first launch is the class MOL-79 was. The
// login screen breaks before there is a session. The screen is a route's name — `login` behind the
// door, `start` until the app is mounted, since the door's store must not be raised by a failure.
// **The price, named:** what throws while the bundle's modules are evaluated, before this line runs,
// reaches nobody — no code of ours runs yet, and a listener in `index.html` would have no way to
// send it but a second copy of these rules.
let mounted = false
const failures = installFailureReports({
  origin: window.location.origin,
  build: pageBuild(import.meta.url, import.meta.env.PROD),
  platform: () => platformLine(),
  screen: () => {
    if (!mounted) return 'start'
    const route = router.currentRoute.value
    if (useLoginStore().closed && route.meta.public !== true) return 'login'
    return typeof route.name === 'string' ? route.name : 'start'
  },
  send: (body) => api.reportClientErrors(body),
})
window.addEventListener('error', (event) => {
  failures.report(event.error, 'window')
})
window.addEventListener('unhandledrejection', (event) => {
  failures.report(event.reason, 'rejection')
})
window.addEventListener('online', () => {
  void failures.flush()
})

/**
 * Everything the start does after the catchers stand. A step that throws is reported as the start's
 * and thrown on, so the console still says it; the window, hearing the same error, does not report
 * it again.
 */
function start(): void {
  // Before the router reads the address: the door of MOL-8 is gone, and this clears what it left
  // on devices that used it — a dead code in storage and a `?c=` that nothing scrubs any more.
  forgetTheInviteDoor()

  // A new version waits for the app to be put away holding no typing, and is looked for when it
  // comes back (MOL-46) — or, on a page that stays on the screen, is taken by «Обновить» (MOL-132).
  // Production only: the dev server builds no worker.
  const UPDATE_MARK = 'molvia.update-applied'
  const update =
    import.meta.env.PROD && 'serviceWorker' in navigator
      ? installPwaUpdate({
          serviceWorker: navigator.serviceWorker,
          script: `${import.meta.env.BASE_URL}sw.js`,
          scope: import.meta.env.BASE_URL,
          holdsTyping: () => holdsTyping(document),
          reload: () => {
            window.location.reload()
          },
          mark: (at) => {
            writeOwn(UPDATE_MARK, String(at))
          },
          takeMark: () => {
            const at = Number(read(UPDATE_MARK, true))
            forget(UPDATE_MARK)
            return Number.isFinite(at) && at > 0 ? at : null
          },
          now: () => Date.now(),
        })
      : NO_UPDATE
  onServerVersion((version) => {
    update.serverVersion(version)
  })

  const app = createApp(App)

  // `index.html` ships `lang="ru"`, which is right until the app boots and wrong the moment the
  // chosen locale is anything else. Done here rather than as a side effect of importing i18n:
  // a module that rewrites the document on import makes import order matter where it should not.
  applyDocumentLang()

  // The script in `index.html` has drawn the stored scheme already; this keeps it, and follows the
  // other windows of the app when one of them changes it (MOL-111).
  installColorScheme()

  // Nothing swallows a render error otherwise, and on a phone at a shelf a blank screen
  // is indistinguishable from a slow one. The console for whoever has it open, and the API's table
  // for the owner (MOL-144).
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[molvia]', info, error)
    failures.report(error, 'vue')
  }

  app.use(createPinia()).use(router).use(i18n)
  app.provide(pwaUpdateKey, update)

  // Одна дверь на все отказы «этого браузера мы больше не знаем», с какого бы запроса отказ ни
  // пришёл: экран входа, а не «что-то пошло не так» на пятнадцати экранах (MOL-56).
  onMissingActor(sessionEnded)

  // Mounted once the first route is settled: a nested screen opened cold gets its parent laid
  // underneath first, so the first paint is already the screen and not a flash of the parent.
  // Transitions and focus are installed after that, so neither step counts as a move.
  void settleColdStart(router)
    // Settling the route is a nicety; the app is not. Vue is not running yet, so its error
    // handler would never see this — logged here, and the app is mounted either way instead of
    // leaving a blank screen at the shelf.
    .catch((error: unknown) => {
      console.error('[molvia]', 'first route', error)
    })
    .finally(() => {
      installViewTransitions(router)
      installArrival(router, (key) => i18n.global.t(key))
      installHeightHold(router)
      installSheetEntryGuard(router)
      app.mount('#app')
      mounted = true
      // What an earlier launch caught with no connection goes now.
      void failures.flush()

      // Raised right after the first paint rather than before it: the store carries the four
      // states a screen shows, so a person gets «loading» instead of a blank page while the
      // identity is being fetched. Every request after this one carries the identifier, and the
      // screen that explains a lost identity is drawn from the same state.
      void useActorStore().start()
    })
}

try {
  start()
} catch (error) {
  failures.report(error, 'start')
  throw error
}
