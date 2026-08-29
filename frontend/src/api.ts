import { createClient } from '@molvia/client'

// Vite proxies /api to this copy's API port, so the origin is never hardcoded.
export const api = createClient({ baseUrl: '/api' })
