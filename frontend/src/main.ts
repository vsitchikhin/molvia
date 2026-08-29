import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/App.vue'
import { i18n } from '@/i18n'
import { router } from '@/router'
import '@/styles/main.scss'

const app = createApp(App)

// Nothing swallows a render error otherwise, and on a phone at a shelf a blank screen
// is indistinguishable from a slow one. The console is the honest destination until
// there are users worth reporting to a service about.
app.config.errorHandler = (error, _instance, info) => {
  console.error('[molvia]', info, error)
}

app.use(createPinia()).use(router).use(i18n).mount('#app')
