import { appendFileSync } from 'node:fs'

const keyId = process.env.B2_BOOTSTRAP_KEY_ID
const applicationKey = process.env.B2_BOOTSTRAP_APPLICATION_KEY
const bucketName = process.env.B2_BUCKET || 'king-sports'
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173'
if (!keyId || !applicationKey) throw new Error('Backblaze bootstrap credentials are missing')

const basic = Buffer.from(`${keyId}:${applicationKey}`).toString('base64')
const authResponse = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', { headers: { Authorization: `Basic ${basic}` } })
if (!authResponse.ok) throw new Error(`Backblaze authorization failed (${authResponse.status})`)
const auth = await authResponse.json()
const storage = auth.apiInfo.storageApi

async function api(operation, body) {
  const response = await fetch(`${storage.apiUrl}/b2api/v4/${operation}`, {
    method: 'POST',
    headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`${operation} failed (${response.status}): ${await response.text()}`)
  return response.json()
}

const listed = await api('b2_list_buckets', { accountId: auth.accountId, bucketName })
let bucket = listed.buckets?.find(item => item.bucketName === bucketName)
const corsRules = [{
  corsRuleName: 'kingSportsWebPlayback',
  allowedOrigins: [webOrigin],
  allowedHeaders: ['range'],
  allowedOperations: ['b2_download_file_by_id', 'b2_download_file_by_name', 's3_get', 's3_head'],
  exposeHeaders: ['content-length', 'content-range', 'content-type'],
  maxAgeSeconds: 3600,
}]

if (!bucket) {
  bucket = await api('b2_create_bucket', {
    accountId: auth.accountId,
    bucketName,
    bucketType: 'allPrivate',
    defaultServerSideEncryption: { mode: 'SSE-B2', algorithm: 'AES256' },
    corsRules,
  })
} else {
  bucket = await api('b2_update_bucket', {
    accountId: auth.accountId,
    bucketId: bucket.bucketId,
    bucketType: 'allPrivate',
    defaultServerSideEncryption: { mode: 'SSE-B2', algorithm: 'AES256' },
    corsRules,
    ifRevisionIs: bucket.revision,
  })
}

const keyPrefix = process.env.B2_KEY_PREFIX || 'king-sports-worker-'
const runtimeKey = await api('b2_create_key', {
  accountId: auth.accountId,
  keyName: `${keyPrefix}${Date.now()}`,
  capabilities: ['listBuckets', 'listFiles', 'readFiles'],
  bucketIds: [bucket.bucketId],
})

// Upload permissions apply only to team logos, not the media library.
const logoKey = await api('b2_create_key', {
  accountId: auth.accountId,
  keyName: `${keyPrefix}logos-${Date.now()}`,
  capabilities: ['readFiles', 'writeFiles', 'deleteFiles'],
  bucketIds: [bucket.bucketId],
  namePrefix: 'team-logos/',
})

// Keep existing keys working until the new Worker secrets have been installed.
// Old keys can be retired after a successful deployment has been verified.

const output = process.env.GITHUB_OUTPUT
if (!output) throw new Error('GITHUB_OUTPUT is unavailable')
console.log(`::add-mask::${runtimeKey.applicationKey}`)
console.log(`::add-mask::${logoKey.applicationKey}`)
appendFileSync(output, `key_id=${runtimeKey.applicationKeyId}\n`)
appendFileSync(output, `application_key=${runtimeKey.applicationKey}\n`)
appendFileSync(output, `endpoint=${storage.s3ApiUrl}\n`)
appendFileSync(output, `bucket_id=${bucket.bucketId}\n`)
appendFileSync(output, `logo_key_id=${logoKey.applicationKeyId}\n`)
appendFileSync(output, `logo_application_key=${logoKey.applicationKey}\n`)
console.log(`Provisioned private bucket ${bucketName}`)
