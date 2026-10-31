import { appendFileSync } from 'node:fs'

const keyId = process.env.B2_BOOTSTRAP_KEY_ID
const applicationKey = process.env.B2_BOOTSTRAP_APPLICATION_KEY
const bucketName = process.env.B2_BUCKET || 'media-bootstrap'
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
  corsRuleName: 'kingVideosWebPlayback',
  allowedOrigins: [webOrigin],
  allowedHeaders: ['range'],
  allowedOperations: ['b2_download_file_by_id', 'b2_download_file_by_name'],
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

const keyPrefix = process.env.B2_KEY_PREFIX || 'media-worker-'
const keyPrefix = process.env.B2_KEY_PREFIX || 'media-worker-'
const runtimeKey = await api('b2_create_key', {
  accountId: auth.accountId,
  keyName: `${keyPrefix}${Date.now()}`,
  capabilities: ['listBuckets', 'listFiles', 'readFiles'],
  bucketIds: [bucket.bucketId],
})

const keys = await api('b2_list_keys', { accountId: auth.accountId, maxKeyCount: 10000 })
for (const key of keys.keys || []) {
  if (key.keyName?.startsWith(keyPrefix) && key.applicationKeyId !== runtimeKey.applicationKeyId) {
    await api('b2_delete_key', { applicationKeyId: key.applicationKeyId })
  }
}

const output = process.env.GITHUB_OUTPUT
if (!output) throw new Error('GITHUB_OUTPUT is unavailable')
appendFileSync(output, `key_id=${runtimeKey.applicationKeyId}\n`)
appendFileSync(output, `application_key=${runtimeKey.applicationKey}\n`)
appendFileSync(output, `endpoint=${storage.s3ApiUrl}\n`)
appendFileSync(output, `bucket_id=${bucket.bucketId}\n`)
console.log(`Provisioned private bucket ${bucketName}`)
