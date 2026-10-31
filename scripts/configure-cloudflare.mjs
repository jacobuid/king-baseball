import { appendFileSync } from 'node:fs'

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !token) throw new Error('Cloudflare credentials are missing')
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

let response = await fetch(endpoint, { headers })
let payload = await response.json()
if (!response.ok || !payload.success) {
  response = await fetch(endpoint, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ subdomain: process.env.CLOUDFLARE_WORKERS_SUBDOMAIN || 'king-sports' }),
  })
  payload = await response.json()
}
if (!response.ok || !payload.success) throw new Error(`Could not configure workers.dev: ${JSON.stringify(payload.errors)}`)
const subdomain = payload.result.subdomain
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `subdomain=${subdomain}\n`)
console.log(`Using workers.dev subdomain ${subdomain}`)
