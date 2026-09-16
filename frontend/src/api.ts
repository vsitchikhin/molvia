import { createClient } from '@molvia/client'

// Read straight from storage rather than from the store: the client is built when the module
// loads, and the store that owns the identity is created after Pinia is installed. A getter
// that reached for the store here would run before there is one.
const KEY = 'molvia.actor'

// Vite proxies /api to this copy's API port, so the origin is never hardcoded.
export const api = createClient({
  baseUrl: '/api',
  actorId: () => {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  },
})
