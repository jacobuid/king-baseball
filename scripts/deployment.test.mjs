import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'king-baseball-deployment-'))
  try { run(directory) } finally { rmSync(directory, { recursive: true, force: true }) }
}
function execute(script, directory, env = {}, mock) {
  const args = []
  if (mock) {
    const preload = join(directory, 'mock.mjs')
    writeFileSync(preload, `globalThis.fetch = ${mock}`)
    args.push('--import', pathToFileURL(preload).href)
  }
  args.push(resolve('scripts', script))
  return spawnSync(process.execPath, args, { cwd: directory, env: { ...env }, encoding: 'utf8' })
}
function configFixture(directory) {
  mkdirSync(join(directory, 'services/api'), { recursive: true })
  writeFileSync(join(directory, 'services/api/wrangler.jsonc'), JSON.stringify({ name: 'old', d1_databases: [{}], vars: {} }))
}
test('API deployment retains the B2 endpoint and uses Baseball resource names', () => fixture(directory => {
  configFixture(directory)
  const result = execute('configure-deployment.mjs', directory, {
    D1_DATABASE_ID: 'test-database', PROJECT_SLUG: 'king-baseball',
    B2_ENDPOINT: 'https://s3.test.example', B2_BUCKET: 'test-baseball', WEB_ORIGIN: 'https://test.github.io',
  })
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(readFileSync(join(directory, 'services/api/wrangler.jsonc')))
  assert.equal(config.name, 'king-baseball-api')
  assert.equal(config.d1_databases[0].database_name, 'king-baseball-prod')
  assert.equal(config.d1_databases[0].database_id, 'test-database')
  assert.equal(config.vars.B2_ENDPOINT, 'https://s3.test.example')
}))
test('routine API deployment discovers the B2 endpoint', () => fixture(directory => {
  configFixture(directory)
  const result = execute('configure-deployment.mjs', directory, {
    D1_DATABASE_ID: 'test', B2_BOOTSTRAP_KEY_ID: 'test', B2_BOOTSTRAP_APPLICATION_KEY: 'test',
  }, `async () => ({ ok: true, json: async () => ({ apiInfo: { storageApi: { s3ApiUrl: 'https://discovered.example' } } }) })`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(readFileSync(join(directory, 'services/api/wrangler.jsonc'))).vars.B2_ENDPOINT, 'https://discovered.example')
}))
test('missing database ID fails before modifying deployment configuration', () => fixture(directory => {
  configFixture(directory)
  const file = join(directory, 'services/api/wrangler.jsonc')
  const original = readFileSync(file, 'utf8')
  assert.notEqual(execute('configure-deployment.mjs', directory).status, 0)
  assert.equal(readFileSync(file, 'utf8'), original)
}))
test('web deployment discovers its own Worker URL', () => fixture(directory => {
  const file = join(directory, 'github-env')
  const result = execute('resolve-api-url.mjs', directory, {
    GITHUB_ENV: file, GITHUB_REPOSITORY: 'test/king-baseball', CLOUDFLARE_ACCOUNT_ID: 'test', CLOUDFLARE_API_TOKEN: 'test',
  }, `async () => ({ ok: true, json: async () => ({ success: true, result: { subdomain: 'shared-account' } }) })`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(file, 'utf8'), 'VITE_API_URL=https://king-baseball-api.shared-account.workers.dev\n')
}))
test('web deployment respects an explicit API URL and rejects injected environment lines', () => fixture(directory => {
  const file = join(directory, 'github-env')
  assert.equal(execute('resolve-api-url.mjs', directory, { GITHUB_ENV: file, VITE_API_URL: 'https://api.example' }).status, 0)
  assert.equal(readFileSync(file, 'utf8'), 'VITE_API_URL=https://api.example\n')
  const unsafeFile = join(directory, 'unsafe-env')
  assert.notEqual(execute('resolve-api-url.mjs', directory, { GITHUB_ENV: unsafeFile, VITE_API_URL: 'https://api.example\nOTHER=value' }).status, 0)
  assert.equal(existsSync(unsafeFile), false)
}))
