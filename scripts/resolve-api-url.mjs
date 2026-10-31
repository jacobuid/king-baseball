import { appendFileSync } from 'node:fs'

let apiUrl = process.env.VITE_API_URL
if (!apiUrl) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]
  if (!accountId || !token || !repository) throw new Error('Set VITE_API_URL or provide Cloudflare credentials and GITHUB_REPOSITORY')
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = await response.json()
  if (!response.ok || !payload.success || !payload.result?.subdomain) throw new Error('Cannot resolve workers.dev subdomain. Run Provision infrastructure first.')
  apiUrl = `https://${repository}-api.${payload.result.subdomain}.workers.dev`
}
const parsed = new URL(apiUrl)
if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /[\r\n]/.test(apiUrl)) throw new Error('VITE_API_URL must be an HTTPS URL without credentials')
if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is unavailable')
appendFileSync(process.env.GITHUB_ENV, `VITE_API_URL=${apiUrl}\n`)
console.log(`Frontend API URL: ${apiUrl}`)
