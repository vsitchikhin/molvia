import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { applyDocumentLang, i18n } from '@/i18n'
import { settleColdStart } from '@/navigation'
import { router } from '@/router'
import { installArrival, installViewTransitions } from '@/transitions'
import { useActorStore } from '@/stores/actor'
import { takeInviteCodeFromUrl } from '@/stores/identity'
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

// Before the router reads the address: otherwise it keeps `?c=` as the current location and
// writes it as «back» into the next entry, where the path `/` is expected.
takeInviteCodeFromUrl()

app.use(createPinia()).use(router).use(i18n)

// Mounted once the first route is settled: a nested screen opened cold gets its parent laid
// underneath first, so the first paint is already the screen and not a flash of the parent.
// Transitions and focus are installed after that, so laying the parent down is not a move.
void settleColdStart(router).then(() => {
  installViewTransitions(router)
  installArrival(router, (key) => i18n.global.t(key))
  app.mount('#app')

  // Raised right after the first paint rather than before it: the store carries the four
  // states a screen shows, so a person gets «loading» instead of a blank page while the
  // identity is being fetched. Every request after this one carries the identifier, and the
  // screen that explains a lost identity is drawn from the same state.
  void useActorStore().start()
})
