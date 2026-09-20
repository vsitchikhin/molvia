import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { applyDocumentLang, i18n } from '@/i18n'
import { settleColdStart } from '@/navigation'
import { router } from '@/router'
import { installArrival, installViewTransitions } from '@/transitions'
import { installSheetEntryGuard } from '@/composables/useSheetHistory'
import { useActorStore } from '@/stores/actor'
import '@/styles/main.scss'

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
