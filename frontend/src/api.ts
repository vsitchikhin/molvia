import { createClient } from '@molvia/client'

// Nothing about identity is passed in, and that is the change MOL-53 made: what proves a
// request is the session cookie, which the browser attaches and no script can read.
// `credentials: 'same-origin'` is already every browser's default — it is written out because
// it is now load-bearing, and a silent change to `omit` would log everybody out.
//
// Vite proxies /api to this copy's API port, so the origin is never hardcoded.
export const api = createClient({ baseUrl: '/api', credentials: 'same-origin' })
