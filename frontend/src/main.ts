import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { applyDocumentLang, i18n } from '@/i18n'
import { settleColdStart } from '@/navigation'
import { router } from '@/router'
import { installArrival, installViewTransitions } from '@/transitions'
import { installSheetEntryGuard } from '@/composables/useSheetHistory'
import { sessionEnded, useActorStore } from '@/stores/actor'
import { forgetTheInviteDoor } from '@/stores/identity'
import { onMissingActor } from '@/api'
import { holdsTyping, installPwaUpdate } from '@/pwaUpdate'
import '@/styles/main.scss'

// Before the router reads the address: the door of MOL-8 is gone, and this clears what it left
// on devices that used it — a dead code in storage and a `?c=` that nothing scrubs any more.
forgetTheInviteDoor()

// A new version waits for the app to be put away holding no typing, and is looked for when it
// comes back (MOL-46). Production only: the dev server builds no worker.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  installPwaUpdate({
    serviceWorker: navigator.serviceWorker,
    script: `${import.meta.env.BASE_URL}sw.js`,
    scope: import.meta.env.BASE_URL,
    holdsTyping: () => holdsTyping(document),
    reload: () => {
      window.location.reload()
    },
  })
}

const app = createApp(App)

// `index.html` ships `lang="ru"`, which is right until the app boots and wrong the moment the
// chosen locale is anything else. Done here rather than as a side effect of importing i18n:
// a module that rewrites the document on import makes import order matter where it should not.
applyDocumentLang()

// Nothing swallows a render error otherwise, and on a phone at a shelf a blank screen
// is indistinguishable from a slow one. The console is the honest destination until
// there are users worth reporting to a service about.
app.config.errorHandler = (error, _instance, info) => {
  console.error('[molvia]', info, error)
}

app.use(createPinia()).use(router).use(i18n)

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
    installSheetEntryGuard(router)
    app.mount('#app')

    // Raised right after the first paint rather than before it: the store carries the four
    // states a screen shows, so a person gets «loading» instead of a blank page while the
    // identity is being fetched. Every request after this one carries the identifier, and the
    // screen that explains a lost identity is drawn from the same state.
    void useActorStore().start()
  })
