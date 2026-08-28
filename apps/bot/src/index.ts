import process from 'node:process'
import { Bot } from 'grammy'
import { createClient } from '@molvia/client'
import { env } from './env'

// Every working copy needs its own bot: two processes on one token steal each other's
// updates through long polling, silently. A copy without a token simply does not start.
if (!env.TELEGRAM_BOT_TOKEN) {
  console.log('TELEGRAM_BOT_TOKEN is empty — this copy has no bot of its own, not starting')
  process.exit(0)
}

const api = createClient({ baseUrl: `http://127.0.0.1:${env.API_PORT}` })
const bot = new Bot(env.TELEGRAM_BOT_TOKEN)

bot.command('start', async (ctx) => {
  const health = await api.health()
  await ctx.reply(`molvia ${health.version}`)
})

await bot.start()
