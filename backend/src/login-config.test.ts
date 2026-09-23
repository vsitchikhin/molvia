import { expect, it } from 'vitest'
import { loginConfiguration } from './login-config'

const configured = { TELEGRAM_BOT_USERNAME: 'molvia_bot', BOT_API_SECRET: 'x'.repeat(43) }

it('development can run without Telegram, production cannot', () => {
  expect(loginConfiguration({ NODE_ENV: 'development' })).toBeNull()
  expect(loginConfiguration({ NODE_ENV: 'production', ...configured })).toEqual({
    username: 'molvia_bot',
    botSecret: 'x'.repeat(43),
  })
  for (const missing of ['TELEGRAM_BOT_USERNAME', 'BOT_API_SECRET']) {
    expect(() =>
      loginConfiguration({ NODE_ENV: 'production', ...configured, [missing]: '' }),
    ).toThrow()
  }
})

it('does not let an invalid username change the link or an invalid secret reach headers', () => {
  for (const TELEGRAM_BOT_USERNAME of ['@molvia_bot', '../other', 'bot?start=x', '']) {
    expect(() =>
      loginConfiguration({ NODE_ENV: 'production', ...configured, TELEGRAM_BOT_USERNAME }),
    ).toThrow()
  }
  expect(() => loginConfiguration({ ...configured, BOT_API_SECRET: 'bad\r\nheader' })).toThrow()
})
