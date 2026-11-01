import { readFileSync, writeFileSync } from 'node:fs'

const path = 'services/api/wrangler.jsonc'
const config = JSON.parse(readFileSync(path, 'utf8'))
if (!process.env.D1_DATABASE_ID) throw new Error('D1_DATABASE_ID is missing')
config.d1_databases[0].database_id = process.env.D1_DATABASE_ID
if (process.env.PROJECT_SLUG) {
  config.name = `${process.env.PROJECT_SLUG}-api`
  config.d1_databases[0].database_name = `${process.env.PROJECT_SLUG}-prod`
}
let b2Endpoint = process.env.B2_ENDPOINT
if (!b2Endpoint && process.env.B2_BOOTSTRAP_KEY_ID && process.env.B2_BOOTSTRAP_APPLICATION_KEY) {
  const basic = Buffer.from(`${process.env.B2_BOOTSTRAP_KEY_ID}:${process.env.B2_BOOTSTRAP_APPLICATION_KEY}`).toString('base64')
  const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })
  if (!response.ok) throw new Error(`Backblaze endpoint lookup failed (${response.status})`)
  b2Endpoint = (await response.json()).apiInfo?.storageApi?.s3ApiUrl
}
if (!b2Endpoint) throw new Error('B2 endpoint is missing; provide B2_ENDPOINT or Backblaze bootstrap credentials')
config.vars.B2_ENDPOINT = b2Endpoint
if (process.env.B2_BUCKET) config.vars.B2_BUCKET = process.env.B2_BUCKET
if (process.env.WEB_ORIGIN) config.vars.WEB_ORIGIN = process.env.WEB_ORIGIN
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)

if (process.env.WRITE_SECRETS !== 'true') process.exit(0)
const secrets = {
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  B2_KEY_ID: process.env.B2_KEY_ID,
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY,
  B2_LOGO_KEY_ID: process.env.B2_LOGO_KEY_ID,
  B2_LOGO_APPLICATION_KEY: process.env.B2_LOGO_APPLICATION_KEY,
}
for (const [name, value] of Object.entries(secrets)) if (!value) throw new Error(`${name} is missing`)
for (const name of ['B2_MUSIC_KEY_ID', 'B2_MUSIC_APPLICATION_KEY', 'MUSIC_SERVICE_TOKEN', 'MUSIC_SERVICE_URL']) {
  if (process.env[name]) secrets[name] = process.env[name]
}
writeFileSync('services/api/.deployment-secrets.json', JSON.stringify(secrets))
