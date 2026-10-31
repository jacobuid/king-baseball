import { readFileSync, writeFileSync } from 'node:fs'

const path = 'services/api/wrangler.jsonc'
const config = JSON.parse(readFileSync(path, 'utf8'))
config.d1_databases[0].database_id = process.env.D1_DATABASE_ID
if (process.env.PROJECT_SLUG) {
  config.name = `${process.env.PROJECT_SLUG}-api`
  config.d1_databases[0].database_name = `${process.env.PROJECT_SLUG}-prod`
}
if (process.env.B2_ENDPOINT) config.vars.B2_ENDPOINT = process.env.B2_ENDPOINT
if (process.env.B2_BUCKET) config.vars.B2_BUCKET = process.env.B2_BUCKET
if (process.env.WEB_ORIGIN) config.vars.WEB_ORIGIN = process.env.WEB_ORIGIN
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)

if (process.env.WRITE_SECRETS !== 'true') process.exit(0)
const secrets = {
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
  B2_KEY_ID: process.env.B2_KEY_ID,
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY,
}
for (const [name, value] of Object.entries(secrets)) if (!value) throw new Error(`${name} is missing`)
writeFileSync('services/api/.deployment-secrets.json', JSON.stringify(secrets))
